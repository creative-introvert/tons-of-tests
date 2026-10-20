import {Array as A, Effect, Exit, Option, Schema, Stream} from 'effect';
import {SqlClient} from 'effect/sql';

import type {TestResult} from '../Test.js';
import type {
    TestRepositoryShape,
    TestResultSchemas,
} from '../Test.repository.js';
import {TestRun} from '../TestRun.js';
import {TestRunNotCreated, TestRunIncomplete} from '../RepositoryError.js';
import {LabelSchema} from './Classify.js';
import {migrate, tables} from './test-repository-migrations.js';
import {withStats} from './test-result-stats.js';

export {tables} from './test-repository-migrations.js';

export const TestResultStorage = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    key: Schema.String,
    ordering: Schema.Int,
    resultOrdering: Schema.Int,
    input: Schema.fromJsonString(Schema.Unknown),
    result: Schema.fromJsonString(Schema.Unknown),
    expected: Schema.fromJsonString(Schema.Unknown),
    label: LabelSchema,
    tags: Schema.fromJsonString(Schema.Array(Schema.String)),
    timeMillis: Schema.Finite,
});
const encodeResult = Schema.encodeEffect(TestResultStorage);
const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(TestRun));
const decodeRunStates = Schema.decodeUnknownEffect(
    Schema.Array(
        Schema.Struct({
            ...TestRun.fields,
            state: Schema.Literals([
                'Untracked',
                'Running',
                'Complete',
                'Failed',
            ]),
        }),
    ),
);
const decodeCount = Schema.decodeUnknownEffect(
    Schema.Tuple([Schema.Struct({count: Schema.Int})]),
);

export const makeTestRepository = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA auto_vacuum = FULL;`;
    yield* migrate;

    const insertTestResults = Effect.fnUntraced(function* (
        results: ReadonlyArray<TestResult>,
        run: TestRun,
    ) {
        // Each statement stays below SQLite's lowest default limit of 999 parameters.
        for (let offset = 0; offset < results.length; offset += 50) {
            const encoded = yield* Effect.forEach(
                results.slice(offset, offset + 50),
                result => encodeResult(result),
            );
            yield* sql`
                INSERT INTO ${sql(tables.testResults)} ${sql.insert(encoded)}
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
        }
    }, sql.withTransaction);

    const getTestResultsStream = <I = unknown, O = unknown, T = unknown>(
        run: TestRun,
        schemas?: TestResultSchemas<I, O, T>,
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
    ) => {
        if (matching !== undefined && matching.length > 50) {
            return Stream.die(
                new Error('Match at most 50 case/key pairs per query.'),
            );
        }
        const input = (schemas?.input ?? Schema.Unknown) as Schema.Codec<I>;
        const result = (schemas?.result ?? Schema.Unknown) as Schema.Codec<O>;
        const expected = (schemas?.expected ??
            Schema.Unknown) as Schema.Codec<T>;
        const decodeRows = Schema.decodeUnknownEffect(
            Schema.Array(
                Schema.Struct({
                    ...TestResultStorage.fields,
                    input: Schema.fromJsonString(input),
                    result: Schema.fromJsonString(result),
                    expected: Schema.fromJsonString(expected),
                }),
            ),
        );
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
                return [
                    rows,
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

    const hasResults = Effect.fnUntraced(function* (run: Pick<TestRun, 'id'>) {
        const [{count}] = yield* decodeCount(
            yield* sql`
            SELECT EXISTS(SELECT 1 FROM ${sql(tables.testRunResults)} WHERE testRun = ${run.id}) AS count;
        `,
        );
        return count > 0;
    });

    const getPreviousTestRun = Effect.fnUntraced(function* (name: string) {
        return A.head(
            yield* decodeRuns(
                yield* sql`
            SELECT * FROM ${sql(tables.testRuns)}
            WHERE hash IS NOT NULL AND name = ${name} ORDER BY id DESC LIMIT 1;
        `,
            ),
        );
    });

    const getLastTestRunHash = Effect.fnUntraced(function* (name: string) {
        return (yield* getPreviousTestRun(name)).pipe(
            Option.flatMap(run => Option.fromNullishOr(run.hash)),
        );
    });

    const getOrCreateCurrentTestRun = Effect.fnUntraced(function* (
        name: string,
    ) {
        const current = A.head(
            yield* decodeRuns(
                yield* sql`
            SELECT * FROM ${sql(tables.testRuns)}
            WHERE hash IS NULL AND name = ${name} ORDER BY id DESC LIMIT 1;
        `,
            ),
        );
        if (Option.isSome(current)) return current.value;
        const inserted = yield* decodeRuns(
            yield* sql`
            INSERT INTO ${sql(tables.testRuns)} ${sql.insert({name})} RETURNING *;
        `,
        );
        return yield* Effect.fromOption(A.head(inserted)).pipe(
            Effect.mapError(() => new TestRunNotCreated({testSuiteName: name})),
        );
    }, sql.withTransaction);

    const clearOrphans = sql`
        DELETE FROM ${sql(tables.testResults)}
        WHERE id NOT IN (SELECT testResult FROM ${sql(tables.testRunResults)});
    `;

    const clearStale = Effect.fnUntraced(function* ({
        name,
        keep = 1,
    }: {
        name: string;
        keep?: number;
    }) {
        const stale = yield* decodeRuns(
            yield* sql`
            SELECT * FROM ${sql(tables.testRuns)}
            WHERE hash IS NOT NULL AND name = ${name} ORDER BY id DESC LIMIT -1 OFFSET ${keep};
        `,
        );
        if (stale.length === 0) return;
        const ids = stale.map(run => run.id);
        yield* sql`DELETE FROM ${sql(tables.testRunResults)} WHERE testRun IN ${sql.in(ids)};`;
        yield* sql`DELETE FROM ${sql(tables.testRuns)} WHERE id IN ${sql.in(ids)};`;
        yield* clearOrphans;
    }, sql.withTransaction);

    const clearUncommitedTestResults = Effect.fnUntraced(function* ({
        name,
    }: {
        name: string;
    }) {
        const current = A.head(
            yield* decodeRuns(
                yield* sql`
            SELECT * FROM ${sql(tables.testRuns)} WHERE name = ${name} AND hash IS NULL;
        `,
            ),
        );
        if (Option.isNone(current)) return;
        yield* sql`UPDATE ${sql(tables.testRuns)} SET state = 'Untracked' WHERE id = ${current.value.id};`;
        yield* sql`DELETE FROM ${sql(tables.testRunResults)} WHERE testRun = ${current.value.id};`;
        yield* clearOrphans;
    }, sql.withTransaction);

    const isComplete = Effect.fnUntraced(function* (run: TestRun) {
        const current = A.head(
            yield* decodeRunStates(
                yield* sql`SELECT * FROM ${sql(tables.testRuns)} WHERE id = ${run.id};`,
            ),
        );
        return Option.isSome(current) && current.value.state === 'Complete';
    });

    const withTestRun = <A, E, R>(
        run: TestRun,
        execute: Effect.Effect<A, E, R>,
    ) =>
        Effect.uninterruptibleMask(restore =>
            sql
                .withTransaction(
                    Effect.gen(function* () {
                        const current = yield* sql`
                    SELECT id FROM ${sql(tables.testRuns)}
                    WHERE id = ${run.id} AND name = ${run.name} AND hash IS NULL;
                `;
                        if (current.length !== 1) {
                            return yield* Effect.die(
                                new Error(
                                    'withTestRun requires the current uncommitted run.',
                                ),
                            );
                        }
                        yield* clearUncommitedTestResults({name: run.name});
                        yield* sql`UPDATE ${sql(tables.testRuns)} SET state = 'Running' WHERE id = ${run.id};`;
                    }),
                )
                .pipe(
                    Effect.flatMap(() =>
                        restore(execute).pipe(
                            Effect.onExit(exit =>
                                sql`
                        UPDATE ${sql(tables.testRuns)}
                        SET state = ${Exit.isSuccess(exit) ? 'Complete' : 'Failed'}
                        WHERE id = ${run.id};
                    `.pipe(Effect.asVoid),
                            ),
                        ),
                    ),
                ),
        );

    const commitCurrentTestRun = Effect.fnUntraced(function* ({
        name,
        hash,
    }: {
        name: string;
        hash: string;
    }) {
        const current = A.head(
            yield* decodeRunStates(
                yield* sql`SELECT * FROM ${sql(tables.testRuns)} WHERE name = ${name} AND hash IS NULL;`,
            ),
        );
        if (
            Option.isSome(current) &&
            (current.value.state === 'Running' ||
                current.value.state === 'Failed')
        ) {
            return yield* new TestRunIncomplete({testSuiteName: name});
        }
        if (Option.isNone(current) || !(yield* hasResults(current.value)))
            return 'NothingToCommit' as const;
        yield* sql`UPDATE ${sql(tables.testRuns)} SET hash = ${hash}, state = 'Complete' WHERE id = ${current.value.id};`;
        yield* sql`INSERT INTO ${sql(tables.testRuns)} ${sql.insert({name})};`;
        return 'Committed' as const;
    }, sql.withTransaction);

    return {
        clearStale,
        clearUncommitedTestResults,
        commitCurrentTestRun,
        getOrCreateCurrentTestRun,
        getLastTestRunHash,
        getPreviousTestRun,
        getTestResultsStream,
        hasResults,
        isComplete,
        withTestRun,
        withStats: use =>
            withStats(use).pipe(
                Effect.provideService(SqlClient.SqlClient, sql),
            ),
        insertTestResult: (result, run) => insertTestResults([result], run),
        insertTestResults,
    } satisfies TestRepositoryShape;
});
