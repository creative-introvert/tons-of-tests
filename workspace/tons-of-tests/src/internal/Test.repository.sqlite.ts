import * as Sql from '@effect/sql';
import * as Sqlite from '@effect/sql-sqlite-node';

import * as P from '../prelude.js';
import type {
    TestRepository as _TestRepository,
    TestResultRead,
    TestRun,
    TestRunResults,
} from '../Test.repository.js';
import {LabelSchema, StatsSchema} from './Classify.js';
import {split} from './lib/Schema.js';
import type {TestResult} from '../Test.js';
import {DuplicateTestResult} from '../Error.js';

export const tables = {
    testResults: 'test-results',
    testRuns: 'test-runs',
    testRunResults: 'test-run-results',
} as const;

const TestResultWriteSchema: P.Schema.Schema<TestResult, TestResultRead> =
    P.Schema.Struct({
        id: P.Schema.String,
        hashTestCase: P.Schema.String,
        ordering: P.Schema.Int,
        input: P.Schema.parseJson(P.Schema.Unknown),
        result: P.Schema.parseJson(P.Schema.Unknown),
        expected: P.Schema.parseJson(P.Schema.Unknown),
        label: LabelSchema,
        tags: split(','),
        timeMillis: P.Schema.Number,
    });

const TestResultsSchema = TestResultWriteSchema.pipe(P.Schema.Array);

const TestRunReadSchema: P.Schema.Schema<TestRun> = P.Schema.Struct({
    id: P.Schema.Int,
    name: P.Schema.String,
    hash: P.Schema.String.pipe(P.Schema.NullOr),
});

const HasResultsSchema = P.Schema.Struct({
    count: P.Schema.Int,
}).pipe(P.Schema.Array);

const TestRunsReadSchema = TestRunReadSchema.pipe(P.Schema.Array);

const TestRunResultsSchema = P.Schema.Struct({
    testRun: P.Schema.Int,
    testResult: P.Schema.String,
}).pipe(P.Schema.Array);

// FIXME: P.Effect.tag
export const TestRepository =
    P.Context.GenericTag<_TestRepository>('TestRunRepository');

export type TestRepository = _TestRepository;

const makeTestRepository = P.Effect.gen(function* () {
    const sql = yield* Sql.client.Client;

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
            P.Effect.gen(function* () {
                const encoded = yield* P.Schema.encode(TestResultWriteSchema)(
                    testResult,
                );

                yield* sql`
                    INSERT INTO ${sql(tables.testResults)}
                    ${sql.insert(encoded)};
                    -- ON CONFLICT(id) DO NOTHING;
                `.pipe(
                    P.Effect.catchIf(
                        _ => _.code === 'SQLITE_CONSTRAINT_PRIMARYKEY',
                        () => P.Effect.fail(new DuplicateTestResult(testResult)),
                    ),
                );
                yield* sql`
                    INSERT INTO ${sql(tables.testRunResults)}
                    VALUES (
                        (
                            SELECT id FROM ${sql(tables.testRuns)}
                            WHERE hash IS NULL AND name = ${name}
                        ),
                        ${encoded.id}
                    );
                    -- I'm pretty sure above catches all cases where this conflict would apply.
                    -- ON CONFLICT(testRun, testResult) DO NOTHING;
                `;
            }),
        );

    const getTestResultsStream = (
        testRun: TestRun,
    ): P.Stream.Stream<
        TestResult,
        Sql.error.SqlError | P.Result.ParseError,
        never
    > =>
        P.Effect.gen(function* () {
            const raw = yield* sql<TestResultRead>`
                SELECT res.* FROM ${sql(tables.testResults)} res
                JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult
                JOIN ${sql(tables.testRuns)} runs ON runs.id = runres.testRun
                WHERE runs.id = ${testRun.id}
                ORDER BY ordering ASC;
            `;
            return yield* P.Schema.decode(TestResultsSchema)(raw);
        }).pipe(P.Stream.fromIterableEffect);

    const hasResults = (testRun: TestRun) =>
        P.Effect.gen(function* () {
            const b = yield* sql<{count: number}>`
                SELECT COUNT(*) count FROM ${sql(tables.testRunResults)}
                WHERE testRun = ${testRun.id};
            `;
            const r = yield* P.Schema.decode(HasResultsSchema)(b);
            return r[0].count > 0;
        });

    const getPreviousTestRun = (name: string) =>
        P.Effect.gen(function* () {
            const r = yield* sql<TestRun>`
                SELECT * FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `;
            const p = yield* P.Schema.decode(TestRunsReadSchema)(r);
            return P.Array.head(p);
        });

    const getAllTestRuns = P.Effect.gen(function* () {
        const results = yield* sql<TestRun>`
                SELECT * from ${sql(tables.testRuns)};
            `;

        return yield* P.Schema.decode(TestRunsReadSchema)(results);
    });

    const getAllTestRunResults = P.Effect.gen(function* () {
        const results = yield* sql<TestRunResults>`
                SELECT * from ${sql(tables.testRunResults)};
            `;

        return yield* P.Schema.decode(TestRunResultsSchema)(results);
    });

    const getAllTestResults = P.Effect.gen(function* () {
        const results = yield* sql<TestResultRead>`
                SELECT * from ${sql(tables.testResults)};
            `;

        return yield* P.Schema.decode(TestResultsSchema)(results);
    });

    const getLastTestRunHash = (name: string) =>
        P.Effect.gen(function* () {
            const current = yield* sql<TestRun>`
                SELECT *
                FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `;

            return current;
        }).pipe(
            P.Effect.map(
                P.flow(
                    P.Array.get(0),
                    P.Option.flatMap(_ => P.Option.fromNullable(_.hash)),
                ),
            ),
        );

    const getOrCreateCurrentTestRun = (name: string) =>
        P.Effect.gen(function* () {
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
        }).pipe(P.Effect.map(P.flow(P.Array.head, P.Option.getOrThrow)));

    const clearStale = ({name, keep = 1}: {name: string; keep?: number}) =>
        sql.withTransaction(
            P.Effect.gen(function* () {
                const staleTestRuns = yield* P.Schema.decode(
                    TestRunsReadSchema,
                )(
                    yield* sql<TestRun>`
                        SELECT *
                        FROM ${sql(tables.testRuns)}
                        WHERE hash IS NOT NULL
                        AND name = ${name}
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
            }),
        );

    const commitCurrentTestRun = ({name, hash}: {name: string; hash: string}) =>
        P.Effect.gen(function* () {
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
        });

    const service: _TestRepository = {
        clearStale,
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

export const LiveLayer = P.Layer.effect(TestRepository, makeTestRepository);

export const makeSqliteLiveLayer = (dbPath: string) =>
    Sqlite.client.layer(
        P.Config.all({
            filename: P.Config.sync(() => dbPath),
        }),
    );

export const SqliteTestLayer = Sqlite.client.layer(
    P.Config.all({
        filename: P.Config.sync(() => ':memory:'),
    }),
);
