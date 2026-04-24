import * as SqlClient from '@effect/sql/SqlClient';
import {
    Array as A,
    Console,
    Effect,
    flow,
    Option,
    Schema,
    Stream,
} from 'effect';

import type {TestResult} from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {
    TestRun,
    type TestRepositoryShape,
    type TestResultRead,
    type TestResultSchemas,
    type TestRunResults,
} from '../Test.repository.types.js';

export {TestRepository};
import {
    RepositoryDecodeError,
    RepositoryQueryError,
    RepositoryWriteError,
    TestRunNotCreated,
} from '../RepositoryError.js';
import {LabelSchema} from './Classify.js';
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

const TestResultsSchema = Schema.Array(TestResultWriteSchema);

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

const TestRunsReadSchema = Schema.Array(TestRun);

const TestRunResultsSchema = Schema.Array(
    Schema.Struct({testRun: Schema.Int, testResult: Schema.String}),
);

export const makeTestRepository = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`PRAGMA auto_vacuum = FULL;`;

    yield* sql`
        CREATE TABLE IF NOT EXISTS ${sql(tables.testRuns)}(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            hash TEXT
        );
    `;

    yield* sql`CREATE INDEX IF NOT EXISTS idx_name_hash ON ${sql(tables.testRuns)}(name, hash)`;

    // At most one "current" (hash IS NULL) row per suite name. Partial index
    // so committed rows are unaffected.
    yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_current_per_name
        ON ${sql(tables.testRuns)}(name)
        WHERE hash IS NULL;
    `;

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

    // Lookup by the junction's `testResult` column: the existing
    // UNIQUE(testRun, testResult) index is keyed on testRun first, so orphan
    // cleanup (`... NOT IN (SELECT testResult ...)`) and stream joins
    // (`res.id = runres.testResult`) would otherwise full-scan the junction.
    yield* sql`CREATE INDEX IF NOT EXISTS idx_trr_testresult ON ${sql(tables.testRunResults)}(testResult)`;
    yield* sql`CREATE INDEX IF NOT EXISTS idx_tr_hashtestcase ON ${sql(tables.testResults)}(hashTestCase)`;

    // SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999; testResults has 9
    // columns and junction rows 2, so 50 rows stays well under the limit.
    const INSERT_BATCH_SIZE = 50;

    const insertTestResults = (
        testResults: ReadonlyArray<TestResult>,
        testRun: TestRun,
    ) =>
        sql
            .withTransaction(
                Effect.gen(function* () {
                    if (testResults.length === 0) return;

                    const encoded = yield* Effect.forEach(testResults, _ =>
                        Schema.encode(TestResultWriteSchema)(_).pipe(
                            Effect.mapError(
                                RepositoryDecodeError.from('insertTestResults'),
                            ),
                        ),
                    );

                    for (
                        let i = 0;
                        i < encoded.length;
                        i += INSERT_BATCH_SIZE
                    ) {
                        const chunk = encoded.slice(i, i + INSERT_BATCH_SIZE);
                        yield* sql`
                        INSERT INTO ${sql(tables.testResults)}
                        ${sql.insert(chunk)}
                        ON CONFLICT(id) DO NOTHING;
                    `.pipe(
                            Effect.mapError(
                                RepositoryWriteError.from('insertTestResults'),
                            ),
                        );
                    }

                    // Junction rows reference the resolved testRun.id directly,
                    // so no correlated subquery.
                    const junction = encoded.map(_ => ({
                        testRun: testRun.id,
                        testResult: _.id,
                    }));
                    for (
                        let i = 0;
                        i < junction.length;
                        i += INSERT_BATCH_SIZE
                    ) {
                        const chunk = junction.slice(i, i + INSERT_BATCH_SIZE);
                        yield* sql`
                        INSERT INTO ${sql(tables.testRunResults)}
                        ${sql.insert(chunk)}
                        ON CONFLICT(testRun, testResult) DO NOTHING;
                    `.pipe(
                            Effect.mapError(
                                RepositoryWriteError.from('insertTestResults'),
                            ),
                        );
                    }
                }),
            )
            .pipe(
                Effect.catchTag('SqlError', e =>
                    Effect.fail(
                        RepositoryWriteError.from('insertTestResults')(e),
                    ),
                ),
            );

    const insertTestResult = (testResult: TestResult, testRun: TestRun) =>
        insertTestResults([testResult], testRun);

    const makeTestResultSchema = <I, O, T>(
        schemas: TestResultSchemas<I, O, T> | undefined,
    ): Schema.Schema<TestResult<I, O, T>, TestResultRead> => {
        const input = (schemas?.input ?? Schema.Unknown) as Schema.Schema<I>;
        const result = (schemas?.result ?? Schema.Unknown) as Schema.Schema<O>;
        const expected = (schemas?.expected ??
            Schema.Unknown) as Schema.Schema<T>;

        return Schema.Struct({
            id: Schema.String,
            hashTestCase: Schema.String,
            ordering: Schema.Int,
            input: Schema.parseJson(input),
            result: Schema.parseJson(result),
            expected: Schema.parseJson(expected),
            label: LabelSchema,
            tags: split(','),
            timeMillis: Schema.Number,
        }) as unknown as Schema.Schema<TestResult<I, O, T>, TestResultRead>;
    };

    const getTestResultsStream = <I = unknown, O = unknown, T = unknown>(
        testRun: TestRun,
        schemas?: TestResultSchemas<I, O, T>,
    ): Stream.Stream<
        TestResult<I, O, T>,
        RepositoryQueryError | RepositoryDecodeError
    > => {
        const RowSchema = makeTestResultSchema(schemas);
        const RowsSchema = Schema.Array(RowSchema);
        // better-sqlite3 is synchronous and doesn't expose a cursor, so the
        // full result set is materialised before emission. Decoding once in
        // bulk avoids fiber-per-row overhead from `Stream.mapEffect`.
        return Stream.unwrap(
            Effect.gen(function* () {
                const rows = yield* sql<TestResultRead>`
                    SELECT res.* FROM ${sql(tables.testResults)} res
                    JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult
                    JOIN ${sql(tables.testRuns)} runs ON runs.id = runres.testRun
                    WHERE runs.id = ${testRun.id}
                    ORDER BY ordering ASC;
                `.pipe(
                    Effect.mapError(
                        RepositoryQueryError.fromSql('getTestResultsStream'),
                    ),
                );
                const decoded = yield* Schema.decodeUnknown(RowsSchema)(
                    rows,
                ).pipe(
                    Effect.mapError(
                        RepositoryDecodeError.from('getTestResultsStream'),
                    ),
                );
                return Stream.fromIterable(decoded);
            }),
        );
    };

    const hasResults = (testRun: TestRun) =>
        Effect.gen(function* () {
            const b = yield* sql<{count: number}>`
                SELECT COUNT(*) count FROM ${sql(tables.testRunResults)}
                WHERE testRun = ${testRun.id};
            `.pipe(Effect.mapError(RepositoryQueryError.fromSql('hasResults')));
            const r = yield* Schema.decodeUnknown(CountSchema)(b).pipe(
                Effect.mapError(RepositoryDecodeError.from('hasResults')),
            );
            return r > 0;
        });

    const getPreviousTestRun = (name: string) =>
        Effect.gen(function* () {
            const r = yield* sql<TestRun>`
                SELECT * FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `.pipe(
                Effect.mapError(
                    RepositoryQueryError.fromSql('getPreviousTestRun'),
                ),
            );
            const p = yield* Schema.decodeUnknown(TestRunsReadSchema)(r).pipe(
                Effect.mapError(
                    RepositoryDecodeError.from('getPreviousTestRun'),
                ),
            );
            return A.head(p);
        });

    const getAllTestRuns = Effect.gen(function* () {
        const results = yield* sql<TestRun>`
            SELECT * from ${sql(tables.testRuns)};
        `.pipe(Effect.mapError(RepositoryQueryError.fromSql('getAllTestRuns')));
        return yield* Schema.decodeUnknown(TestRunsReadSchema)(results).pipe(
            Effect.mapError(RepositoryDecodeError.from('getAllTestRuns')),
        );
    });

    const getAllTestRunResults = Effect.gen(function* () {
        const results = yield* sql<TestRunResults>`
            SELECT * from ${sql(tables.testRunResults)};
        `.pipe(
            Effect.mapError(
                RepositoryQueryError.fromSql('getAllTestRunResults'),
            ),
        );
        return yield* Schema.decodeUnknown(TestRunResultsSchema)(results).pipe(
            Effect.mapError(RepositoryDecodeError.from('getAllTestRunResults')),
        );
    });

    const getAllTestResults = Effect.gen(function* () {
        const results = yield* sql<TestResultRead>`
            SELECT * from ${sql(tables.testResults)};
        `.pipe(
            Effect.mapError(RepositoryQueryError.fromSql('getAllTestResults')),
        );
        return yield* Schema.decodeUnknown(TestResultsSchema)(results).pipe(
            Effect.mapError(RepositoryDecodeError.from('getAllTestResults')),
        );
    });

    const getLastTestRunHash = (name: string) =>
        sql<TestRun>`
            SELECT *
            FROM ${sql(tables.testRuns)}
            WHERE hash IS NOT NULL AND name = ${name}
            ORDER BY id DESC
            LIMIT 1;
        `.pipe(
            Effect.mapError(RepositoryQueryError.fromSql('getLastTestRunHash')),
            Effect.map(
                flow(
                    A.get(0),
                    Option.flatMap(_ => Option.fromNullable(_.hash)),
                ),
            ),
        );

    const getOrCreateCurrentTestRun = (name: string) =>
        sql
            .withTransaction(
                Effect.gen(function* () {
                    const currentRaw = yield* sql<TestRun>`
                    SELECT *
                    FROM ${sql(tables.testRuns)}
                    WHERE hash IS NULL AND name = ${name}
                    ORDER BY id DESC
                    LIMIT 1;
                `.pipe(
                        Effect.mapError(
                            RepositoryQueryError.fromSql(
                                'getOrCreateCurrentTestRun',
                            ),
                        ),
                    );

                    const current = yield* Schema.decodeUnknown(
                        TestRunsReadSchema,
                    )(currentRaw).pipe(
                        Effect.mapError(
                            RepositoryDecodeError.from(
                                'getOrCreateCurrentTestRun',
                            ),
                        ),
                    );

                    const existing = A.head(current);
                    if (Option.isSome(existing)) {
                        return existing.value;
                    }

                    const insertedRaw = yield* sql<TestRun>`
                    INSERT INTO ${sql(tables.testRuns)}
                    ${sql.insert({name})}
                    RETURNING *;
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from(
                                'getOrCreateCurrentTestRun',
                            ),
                        ),
                    );

                    const inserted = yield* Schema.decodeUnknown(
                        TestRunsReadSchema,
                    )(insertedRaw).pipe(
                        Effect.mapError(
                            RepositoryDecodeError.from(
                                'getOrCreateCurrentTestRun',
                            ),
                        ),
                    );

                    return yield* A.head(inserted).pipe(
                        Option.match({
                            onNone: () =>
                                Effect.fail(new TestRunNotCreated({name})),
                            onSome: Effect.succeed,
                        }),
                    );
                }),
            )
            .pipe(
                Effect.catchTag('SqlError', e =>
                    Effect.fail(
                        RepositoryQueryError.fromSql(
                            'getOrCreateCurrentTestRun',
                        )(e),
                    ),
                ),
            );

    const clearStale = ({name, keep = 1}: {name: string; keep?: number}) =>
        sql
            .withTransaction(
                Effect.gen(function* () {
                    const raw = yield* sql<TestRun>`
                    SELECT *
                    FROM ${sql(tables.testRuns)}
                    WHERE hash IS NOT NULL AND name = ${name}
                    ORDER BY id DESC
                    LIMIT -1 OFFSET ${keep};
                `.pipe(
                        Effect.mapError(
                            RepositoryQueryError.fromSql('clearStale'),
                        ),
                    );

                    const staleTestRuns = yield* Schema.decodeUnknown(
                        TestRunsReadSchema,
                    )(raw).pipe(
                        Effect.mapError(
                            RepositoryDecodeError.from('clearStale'),
                        ),
                    );

                    if (staleTestRuns.length === 0) {
                        return;
                    }

                    const ids = staleTestRuns.map(r => r.id);

                    yield* sql`
                    DELETE FROM ${sql(tables.testRunResults)}
                    WHERE testRun IN ${sql.in(ids)};
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from('clearStale'),
                        ),
                    );

                    yield* sql`
                    DELETE FROM ${sql(tables.testRuns)}
                    WHERE id IN ${sql.in(ids)};
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from('clearStale'),
                        ),
                    );

                    yield* sql`
                    DELETE FROM ${sql(tables.testResults)}
                    WHERE id NOT IN (
                        SELECT DISTINCT testResult FROM ${sql(tables.testRunResults)}
                    );
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from('clearStale'),
                        ),
                    );

                    yield* Console.log('Cleared stale test runs.');
                }),
            )
            .pipe(
                Effect.catchTag('SqlError', e =>
                    Effect.fail(RepositoryWriteError.from('clearStale')(e)),
                ),
            );

    const clearUncommitedTestResults = ({name}: {name: string}) =>
        sql
            .withTransaction(
                Effect.gen(function* () {
                    const currentRaw = yield* sql<TestRun>`
                    SELECT *
                    FROM ${sql(tables.testRuns)}
                    WHERE hash IS NULL AND name = ${name}
                    ORDER BY id DESC
                    LIMIT 1;
                `.pipe(
                        Effect.mapError(
                            RepositoryQueryError.fromSql(
                                'clearUncommitedTestResults',
                            ),
                        ),
                    );

                    const current = yield* Schema.decodeUnknown(
                        TestRunsReadSchema,
                    )(currentRaw).pipe(
                        Effect.mapError(
                            RepositoryDecodeError.from(
                                'clearUncommitedTestResults',
                            ),
                        ),
                    );

                    const currentTestRun = A.head(current);
                    if (Option.isNone(currentTestRun)) {
                        return;
                    }

                    yield* sql`
                    DELETE FROM ${sql(tables.testRunResults)}
                    WHERE testRun = ${currentTestRun.value.id};
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from(
                                'clearUncommitedTestResults',
                            ),
                        ),
                    );

                    yield* sql`
                    DELETE FROM ${sql(tables.testResults)}
                    WHERE id NOT IN (
                        SELECT DISTINCT testResult FROM ${sql(tables.testRunResults)}
                    );
                `.pipe(
                        Effect.mapError(
                            RepositoryWriteError.from(
                                'clearUncommitedTestResults',
                            ),
                        ),
                    );
                }),
            )
            .pipe(
                Effect.catchTag('SqlError', e =>
                    Effect.fail(
                        RepositoryWriteError.from('clearUncommitedTestResults')(
                            e,
                        ),
                    ),
                ),
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
                `.pipe(
                    Effect.mapError(
                        RepositoryQueryError.fromSql('commitCurrentTestRun'),
                    ),
                ),
            ).pipe(
                Effect.mapError(
                    RepositoryDecodeError.from('commitCurrentTestRun'),
                ),
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
            `.pipe(
                Effect.mapError(
                    RepositoryWriteError.from('commitCurrentTestRun'),
                ),
            );

            yield* sql`
                INSERT INTO ${sql(tables.testRuns)}
                ${sql.insert({name})};
            `.pipe(
                Effect.mapError(
                    RepositoryWriteError.from('commitCurrentTestRun'),
                ),
            );

            yield* Console.log('Commited test run.');
        });

    const service: TestRepositoryShape = {
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
        insertTestResults,
        getAllTestRunResults,
    };

    return service;
});
