import * as Sql from '@effect/sql';
import * as Sqlite from '@effect/sql-sqlite-node';
import {
    Array as A,
    Config,
    Console,
    Context,
    Effect,
    Layer,
    Option,
    ParseResult,
    Schema,
    Stream,
    flow,
} from 'effect';

import type {TestResult} from '../Test.js';
import type {
    TestResultRead,
    TestRun,
    TestRunResults,
    TestRepository as _TestRepository,
} from '../Test.repository.js';
import {LabelSchema, StatsSchema} from './Classify.js';
import {split} from './lib/Schema.js';

export const tables = {
    testResults: 'test-results',
    testRuns: 'test-runs',
    testRunResults: 'test-run-results',
} as const;

const TestResultWriteSchema: Schema.Schema<TestResult, TestResultRead> =
    Schema.Struct({
        id: Schema.String,
        hashTestCase: Schema.String,
        ordering: Schema.Int,
        input: Schema.parseJson(Schema.Unknown),
        result: Schema.parseJson(Schema.Unknown),
        expected: Schema.parseJson(Schema.Unknown),
        label: LabelSchema,
        tags: split(','),
        timeMillis: Schema.Number,
    });

const TestResultsSchema = TestResultWriteSchema.pipe(Schema.Array);

const TestRunReadSchema: Schema.Schema<TestRun> = Schema.Struct({
    id: Schema.Int,
    name: Schema.String,
    // TODO: Is this a hash, or uuid?
    hash: Schema.String.pipe(Schema.NullOr),
});

const CountSchema = Schema.Tuple(
    Schema.Struct({
        count: Schema.Int,
    }),
).pipe(
    Schema.transform(Schema.Int, {
        decode: ([{count}]) => count,
        encode: count => [{count}],
    }),
);

const TestRunsReadSchema = TestRunReadSchema.pipe(Schema.Array);
const CurrentTestRunSchema = Schema.Tuple(TestRunReadSchema).pipe(
    Schema.transform(TestRunReadSchema, {encode: _ => [_], decode: ([_]) => _}),
);

const TestRunResultsSchema = Schema.Struct({
    testRun: Schema.Int,
    testResult: Schema.String,
}).pipe(Schema.Array);

// FIXME: Effect.tag
export const TestRepository =
    Context.GenericTag<_TestRepository>('TestRunRepository');

export type TestRepository = _TestRepository;

const makeTestRepository = Effect.gen(function* () {
    const sql = yield* Sql.SqlClient.SqlClient;

    yield* sql`PRAGMA auto_vacuum = FULL;`;

    yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(tables.testRuns)}(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            hash TEXT,
            UNIQUE (id, name, hash)
        );
    `;

    yield* sql`CREATE INDEX IF NOT EXISTS idx_name_hash ON ${sql(tables.testRuns)}(name, hash)`;

    yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(tables.testResults)}(
            id TEXT PRIMARY KEY,
            hashTestCase TEXT NOT NULL,
            ordering INTEGER NOT NULL,
            input TEXT,
            result TEXT,
            expected TEXT,
            label TEXT NOT NULL,
            tags TEXT NOT NULL,
            timeMillis INTEGER NOT NULL
        );
    `;

    yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(tables.testRunResults)}(
            testRun INTEGER NOT NULL,
            testResult TEXT NOT NULL,
            FOREIGN KEY (testRun) REFERENCES ${sql(tables.testRuns)}(id),
            FOREIGN KEY (testResult) REFERENCES ${sql(tables.testResults)}(id),
            UNIQUE (testRun, testResult)
        );
    `;

    /** Assumes that a `TestRun` with hash=null exists. */
    const insertTestResult = (testResult: TestResult, name: string) =>
        sql.withTransaction(
            Effect.gen(function* () {
                const encoded = yield* Schema.encode(TestResultWriteSchema)(
                    testResult,
                );

                yield* sql`
                    INSERT INTO ${sql(tables.testResults)}
                    ${sql.insert(encoded)}
                    ON CONFLICT(id) DO NOTHING;
                `;

                yield* sql`
                    INSERT INTO ${sql(tables.testRunResults)}
                    VALUES (
                        (
                            SELECT id FROM ${sql(tables.testRuns)}
                            WHERE hash IS NULL AND name = ${name}
                        ),
                        ${encoded.id}
                    )
                    ON CONFLICT(testRun, testResult) DO NOTHING;
                `;
            }),
        );

    const getTestResultsStream = (
        testRun: TestRun,
    ): Stream.Stream<
        TestResult,
        Sql.SqlError.SqlError | ParseResult.ParseError,
        never
    > =>
        Effect.gen(function* () {
            const raw = yield* sql<TestResultRead>`
                SELECT res.* FROM ${sql(tables.testResults)} res
                JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult
                JOIN ${sql(tables.testRuns)} runs ON runs.id = runres.testRun
                WHERE runs.id = ${testRun.id}
                ORDER BY ordering ASC;
            `;
            return yield* Schema.decode(TestResultsSchema)(raw);
        }).pipe(Stream.fromIterableEffect);

    const hasResults = (testRun: TestRun) =>
        Effect.gen(function* () {
            const b = yield* sql<{count: number}>`
                SELECT COUNT(*) count FROM ${sql(tables.testRunResults)}
                WHERE testRun = ${testRun.id};
            `;
            const r = yield* Schema.decodeUnknown(CountSchema)(b);
            return r > 0;
        });

    const getPreviousTestRun = (name: string) =>
        Effect.gen(function* () {
            const r = yield* sql<TestRun>`
                SELECT * FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `;
            const p = yield* Schema.decode(TestRunsReadSchema)(r);
            return A.head(p);
        });

    const getAllTestRuns = Effect.gen(function* () {
        const results = yield* sql<TestRun>`
                SELECT * from ${sql(tables.testRuns)};
            `;

        return yield* Schema.decode(TestRunsReadSchema)(results);
    });

    const getAllTestRunResults = Effect.gen(function* () {
        const results = yield* sql<TestRunResults>`
                SELECT * from ${sql(tables.testRunResults)};
            `;

        return yield* Schema.decode(TestRunResultsSchema)(results);
    });

    const getAllTestResults = Effect.gen(function* () {
        const results = yield* sql<TestResultRead>`
                SELECT * from ${sql(tables.testResults)};
            `;

        return yield* Schema.decode(TestResultsSchema)(results);
    });

    const getLastTestRunHash = (name: string) =>
        Effect.gen(function* () {
            const current = yield* sql<TestRun>`
                SELECT *
                FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `;

            return current;
        }).pipe(
            Effect.map(
                flow(
                    A.get(0),
                    Option.flatMap(_ => Option.fromNullable(_.hash)),
                ),
            ),
        );

    const getOrCreateCurrentTestRun = (name: string) =>
        Effect.gen(function* () {
            const current = yield* sql<TestRun>`
                SELECT *
                FROM ${sql(tables.testRuns)}
                WHERE hash IS NULL AND name = ${name};
            `;

            if (current.length === 0) {
                return yield* sql<TestRun>`
                    INSERT INTO ${sql(tables.testRuns)}
                    ${sql.insert({name})}
                    RETURNING *;
                `;
            }

            return current;
        }).pipe(Effect.map(flow(A.head, Option.getOrThrow)));

    const clearStale = ({name, keep = 1}: {name: string; keep?: number}) =>
        sql.withTransaction(
            Effect.gen(function* () {
                const staleTestRuns = yield* Schema.decode(TestRunsReadSchema)(
                    yield* sql<TestRun>`
                        SELECT *
                        FROM ${sql(tables.testRuns)}
                        WHERE hash IS NOT NULL AND name = ${name}
                        ORDER BY id DESC
                        LIMIT -1 OFFSET ${keep};
                    `,
                );

                if (staleTestRuns.length === 0) {
                    return;
                }

                const ids = staleTestRuns.map(r => r.id);

                yield* sql`
                    DELETE FROM ${sql(tables.testRunResults)}
                    WHERE testRun IN ${sql.in(ids)};
                `;

                yield* sql`
                    DELETE FROM ${sql(tables.testRuns)}
                    WHERE id IN ${sql.in(ids)};
                `;

                yield* sql`
                    DELETE FROM ${sql(tables.testResults)}
                    WHERE id NOT IN (
                        SELECT DISTINCT testResult FROM ${sql(tables.testRunResults)}
                    );
                `;

                yield* Console.log('Cleared stale test runs.');
            }),
        );

    const clearUncommitedTestResults = ({name}: {name: string}) =>
        sql.withTransaction(
            Effect.gen(function* () {
                const currentTestRun = yield* Schema.decodeUnknown(
                    CurrentTestRunSchema,
                )(
                    yield* sql<TestRun>`
                        SELECT *
                        FROM ${sql(tables.testRuns)}
                        WHERE hash IS NULL AND name = ${name};
                    `,
                );

                yield* sql`
                    DELETE FROM ${sql(tables.testRunResults)}
                    WHERE testRun = ${currentTestRun.id};
                `;

                yield* sql`
                    DELETE FROM ${sql(tables.testResults)}
                    WHERE id NOT IN (
                        SELECT DISTINCT testResult FROM ${sql(tables.testRunResults)}
                    );
                `;
            }),
        );

    const commitCurrentTestRun = ({name, hash}: {name: string; hash: string}) =>
        Effect.gen(function* () {
            const currentTestRunResults = yield* Schema.decodeUnknown(
                CountSchema,
            )(
                yield* sql`
                    SELECT COUNT(*) count FROM ${sql(tables.testRunResults)}
                    WHERE testRun = (
                        SELECT id
                        FROM ${sql(tables.testRuns)}
                        WHERE hash IS NULL AND name = ${name}
                    );
            `,
            );

            if (currentTestRunResults === 0) {
                yield* Console.log(
                    'Current run has no test results, not commiting.',
                );
                return;
            }

            yield* sql`
                UPDATE ${sql(tables.testRuns)}
                SET hash = ${hash}
                WHERE id = (
                    SELECT id
                    FROM ${sql(tables.testRuns)}
                    WHERE hash IS NULL AND name = ${name}
                );
            `;

            yield* sql`
                INSERT INTO ${sql(tables.testRuns)}
                ${sql.insert({name})};
            `;
            yield* Console.log('Commited test run.');
        });

    const service: _TestRepository = {
        clearStale,
        clearUncommitedTestResults,
        commitCurrentTestRun,
        getAllTestResults,
        getAllTestRuns,
        getOrCreateCurrentTestRun,
        getLastTestRunHash,
        getPreviousTestRun,
        getTestResultsStream,
        hasResults,
        insertTestResult,
        getAllTestRunResults,
    };

    return service;
});

export const LiveLayer = Layer.effect(TestRepository, makeTestRepository);

export const makeSqliteLiveLayer = (dbPath: string) =>
    Sqlite.SqliteClient.layer({filename: dbPath});

export const SqliteTestLayer = Sqlite.SqliteClient.layer({
    filename: ':memory:',
});
