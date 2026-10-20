import {Array as A, Effect, Exit, Option, Schema, Stream} from 'effect';
import {SqlClient} from 'effect/sql';

import type {TestResult} from '../Test.js';
import type {
    TestRepositoryShape,
    TestResultSchemas,
} from '../Test.repository.js';
import {TestRun} from '../TestRun.js';
import {
    TestRunNotCreated,
    TestRunIncomplete,
    TestRunNotFound,
} from '../RepositoryError.js';
import {LabelSchema} from './Classify.js';
import {migrate, tables} from './test-repository-migrations.js';
import {withStats} from './test-result-stats.js';
import {makeResultCodec, stringifyJson} from './Test.serialization.js';

export {tables} from './test-repository-migrations.js';

export const TestResultStorage = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    key: Schema.String,
    input: Schema.fromJsonString(Schema.Json),
    result: Schema.fromJsonString(Schema.Json),
    expected: Schema.fromJsonString(Schema.Json),
    label: LabelSchema,
});
const StoredResult = Schema.Struct({
    ...TestResultStorage.fields,
    input: Schema.String,
    result: Schema.String,
    expected: Schema.String,
    ordering: Schema.Int,
    resultOrdering: Schema.Int,
    tags: Schema.fromJsonString(Schema.Array(Schema.String)),
    timeMillis: Schema.Finite,
});
const encodeResult = Schema.encodeEffect(StoredResult);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(StoredResult));
const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(TestRun));
const decodeListedRuns = Schema.decodeUnknownEffect(
    Schema.Array(
        Schema.Struct({
            ...TestRun.fields,
            isBaseline: Schema.Literals([0, 1]),
        }),
    ),
);
const decodeVariantBaselines = Schema.decodeUnknownEffect(
    Schema.Array(
        Schema.Struct({
            variant: Schema.String,
            id: Schema.NullOr(TestRun.fields.id),
            name: Schema.NullOr(TestRun.fields.name),
            state: Schema.NullOr(TestRun.fields.state),
        }),
    ),
);
const decodeRunLimit = Schema.decodeUnknownEffect(
    Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 100})),
);

export const makeTestRepository = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA auto_vacuum = FULL;`;
    yield* migrate;

    const getTestRun = Effect.fnUntraced(function* (id: number) {
        return A.head(
            yield* decodeRuns(
                yield* sql`SELECT * FROM ${sql(tables.testRuns)} WHERE id = ${id};`,
            ),
        );
    });

    const insertTestResults = Effect.fnUntraced(function* <I, O, T>(
        results: ReadonlyArray<TestResult<I, O, T>>,
        run: TestRun,
        schemas: TestResultSchemas<I, O, T>,
    ) {
        const codec = makeResultCodec(schemas, run.name);
        // Each statement stays below SQLite's lowest default limit of 999 parameters.
        for (
            let offset = 0;
            offset < Math.max(1, results.length);
            offset += 50
        ) {
            const encoded = yield* Effect.forEach(
                results.slice(offset, offset + 50),
                Effect.fnUntraced(function* (result) {
                    const encoded = yield* codec.encode(result);
                    return yield* encodeResult({
                        ...encoded,
                        input: stringifyJson(encoded.input),
                        result: stringifyJson(encoded.result),
                        expected: stringifyJson(encoded.expected),
                    });
                }),
            );
            yield* sql.withTransaction(
                Effect.gen(function* () {
                    const saved = yield* getTestRun(run.id);
                    if (Option.isNone(saved)) {
                        return yield* new TestRunNotFound({testRunId: run.id});
                    }
                    if (saved.value.state !== 'Running') {
                        return yield* Effect.die(
                            new Error(
                                'Only Running test runs accept result writes.',
                            ),
                        );
                    }
                    if (encoded.length === 0) return;
                    const content = encoded.map(result => ({
                        id: result.id,
                        hashTestCase: result.hashTestCase,
                        key: result.key,
                        input: result.input,
                        result: result.result,
                        expected: result.expected,
                        label: result.label,
                    }));
                    yield* sql`
                        INSERT INTO ${sql(tables.testResults)} ${sql.insert(content)}
                        ON CONFLICT(id) DO NOTHING;
                    `;
                    const links = encoded.map(result => ({
                        testRun: run.id,
                        testResult: result.id,
                        ordering: result.ordering,
                        resultOrdering: result.resultOrdering,
                        timeMillis: result.timeMillis,
                        tags: result.tags,
                    }));
                    yield* sql`
                        INSERT INTO ${sql(tables.testRunResults)} ${sql.insert(links)}
                        ON CONFLICT(testRun, testResult) DO UPDATE SET
                            ordering = excluded.ordering,
                            resultOrdering = excluded.resultOrdering,
                            timeMillis = excluded.timeMillis,
                            tags = excluded.tags;
                    `;
                }),
            );
        }
    });

    const getTestResultsStream = <I = unknown, O = unknown, T = unknown>(
        run: TestRun,
        schemas: TestResultSchemas<I, O, T>,
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
    ) => {
        if (matching !== undefined && matching.length > 50) {
            return Stream.die(
                new Error('Match at most 50 case/key pairs per query.'),
            );
        }
        const codec = makeResultCodec(schemas, run.name);
        const filter =
            matching === undefined
                ? sql`1 = 1`
                : matching.length === 0
                  ? sql`1 = 0`
                  : sql.or(
                        matching.map(
                            key =>
                                sql`res.hashTestCase = ${key.hashTestCase} AND res.key = ${key.key}`,
                        ),
                    );
        // Match case/key pairs first, so each batch avoids scanning the whole prior run.
        // CROSS JOIN keeps SQLite from choosing the run-order index for that lookup.
        const from =
            matching === undefined
                ? sql`${sql(tables.testRunResults)} runres
                JOIN ${sql(tables.testResults)} res ON res.id = runres.testResult`
                : sql`${sql(tables.testResults)} res
                CROSS JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult`;

        // The driver cannot stream a query. Keyset pages keep decoded rows bounded.
        return Stream.paginate(
            undefined,
            Effect.fnUntraced(function* (
                after:
                    | Pick<TestResult, 'ordering' | 'resultOrdering' | 'id'>
                    | undefined,
            ) {
                const rows = yield* decodeRows(
                    yield* sql`
                SELECT res.id, res.hashTestCase, res.key,
                    runres.ordering, runres.resultOrdering, res.input, res.result,
                    res.expected, res.label, runres.tags, runres.timeMillis
                FROM ${from}
                WHERE runres.testRun = ${run.id} AND ${filter}
                    AND ${
                        after === undefined
                            ? sql`1 = 1`
                            : sql`
                        (runres.ordering, runres.resultOrdering, runres.testResult) >
                        (${after.ordering}, ${after.resultOrdering}, ${after.id})
                    `
                    }
                ORDER BY runres.ordering, runres.resultOrdering, runres.testResult
                LIMIT 100;
            `,
                );
                const last = rows[rows.length - 1];
                const decoded = yield* Effect.forEach(rows, codec.decode);
                return [
                    decoded,
                    rows.length < 100
                        ? Option.none()
                        : Option.some({
                              ordering: last.ordering,
                              resultOrdering: last.resultOrdering,
                              id: last.id,
                          }),
                ] as const;
            }),
        );
    };

    const getLatestTestRun = Effect.fnUntraced(function* ({
        name,
        variant,
    }: {
        name: string;
        variant: string;
    }) {
        return A.head(
            yield* decodeRuns(
                yield* sql`
                    SELECT * FROM ${sql(tables.testRuns)}
                    WHERE name = ${name} AND variant = ${variant}
                    ORDER BY id DESC LIMIT 1;
                `,
            ),
        );
    });

    const getBaselineTestRun = Effect.fnUntraced(function* ({
        name,
        variant,
    }: {
        name: string;
        variant: string;
    }) {
        return A.head(
            yield* decodeRuns(
                yield* sql`
                    SELECT run.* FROM ${sql(tables.testBaselines)} baseline
                    JOIN ${sql(tables.testRuns)} run ON run.id = baseline.testRun
                    WHERE baseline.name = ${name} AND baseline.variant = ${variant};
                `,
            ),
        );
    });

    const createTestRun = Effect.fnUntraced(function* (input: {
        name: string;
        variant: string;
    }) {
        const inserted = yield* decodeRuns(
            yield* sql`
                INSERT INTO ${sql(tables.testRuns)}
                ${sql.insert({...input, state: 'Running'})} RETURNING *;
            `,
        );
        return yield* Effect.fromOption(A.head(inserted)).pipe(
            Effect.mapError(
                () => new TestRunNotCreated({testSuiteName: input.name}),
            ),
        );
    }, sql.withTransaction);

    const finishTestRun = Effect.fnUntraced(function* (
        run: TestRun,
        state: 'Complete' | 'Failed',
    ) {
        const updated = A.head(
            yield* decodeRuns(
                yield* sql`
                    UPDATE ${sql(tables.testRuns)} SET state = ${state}
                    WHERE id = ${run.id} AND state = 'Running' RETURNING *;
                `,
            ),
        );
        if (Option.isNone(updated)) {
            return yield* new TestRunNotFound({testRunId: run.id});
        }
    }, sql.withTransaction);

    const withTestRun = <A, E = never, R = never>(
        input: {name: string; variant: string},
        execute: (run: TestRun) => Effect.Effect<A, E, R>,
    ) =>
        Effect.acquireUseRelease(
            createTestRun(input),
            run =>
                Effect.suspend(() => execute(run)).pipe(
                    Effect.map(value => ({run, value})),
                ),
            (run, exit) =>
                finishTestRun(
                    run,
                    Exit.isSuccess(exit) ? 'Complete' : 'Failed',
                ),
        ).pipe(
            Effect.map(({run, value}) => ({
                run: new TestRun({
                    id: run.id,
                    name: run.name,
                    variant: run.variant,
                    state: 'Complete',
                }),
                value,
            })),
        );

    const commitTestRun = Effect.fnUntraced(function* (id: number) {
        const found = yield* getTestRun(id);
        if (Option.isNone(found)) {
            return yield* new TestRunNotFound({testRunId: id});
        }
        const run = found.value;
        if (run.state !== 'Complete') {
            return yield* new TestRunIncomplete({
                testSuiteName: run.name,
                testRunId: run.id,
                variant: run.variant,
            });
        }
        yield* sql`
            INSERT INTO ${sql(tables.testBaselines)}
            ${sql.insert({name: run.name, variant: run.variant, testRun: run.id})}
            ON CONFLICT(name, variant) DO UPDATE SET testRun = excluded.testRun;
        `;
    }, sql.withTransaction);

    const listTestRuns = Effect.fnUntraced(function* ({
        name,
        variant,
        before,
        limit,
    }: {
        name: string;
        variant?: string;
        before?: number;
        limit: number;
    }) {
        const parsedLimit = yield* decodeRunLimit(limit);
        const runs = yield* decodeListedRuns(
            yield* sql`
                SELECT run.*, EXISTS(
                    SELECT 1 FROM ${sql(tables.testBaselines)} baseline
                    WHERE baseline.name = run.name AND baseline.variant = run.variant
                        AND baseline.testRun = run.id
                ) AS isBaseline
                FROM ${sql(tables.testRuns)} run
                WHERE run.name = ${name}
                    AND ${variant === undefined ? sql`1 = 1` : sql`run.variant = ${variant}`}
                    AND ${before === undefined ? sql`1 = 1` : sql`run.id < ${before}`}
                ORDER BY run.id DESC LIMIT ${parsedLimit};
            `,
        );
        return runs.map(({isBaseline, ...run}) =>
            Object.assign(new TestRun(run), {isBaseline: isBaseline === 1}),
        );
    });

    const listVariantBaselines = Effect.fnUntraced(function* (name: string) {
        const variants = yield* decodeVariantBaselines(
            yield* sql`
                SELECT variants.variant, run.id, run.name, run.state
                FROM (
                    SELECT DISTINCT variant FROM ${sql(tables.testRuns)}
                    WHERE name = ${name}
                ) variants
                LEFT JOIN ${sql(tables.testBaselines)} baseline
                    ON baseline.name = ${name} AND baseline.variant = variants.variant
                LEFT JOIN ${sql(tables.testRuns)} run ON run.id = baseline.testRun
                ORDER BY variants.variant;
            `,
        );
        return variants.map(({variant, id, name, state}) => ({
            variant,
            baseline:
                id === null || name === null || state === null
                    ? Option.none<TestRun>()
                    : Option.some(new TestRun({id, name, variant, state})),
        }));
    });

    return {
        commitTestRun,
        getTestRun,
        getLatestTestRun,
        getBaselineTestRun,
        listTestRuns,
        listVariantBaselines,
        getTestResultsStream,
        withTestRun,
        withStats: use =>
            withStats(use).pipe(
                Effect.provideService(SqlClient.SqlClient, sql),
            ),
        insertTestResult: (result, run, schemas) =>
            insertTestResults([result], run, schemas),
        insertTestResults,
    } satisfies TestRepositoryShape;
});
