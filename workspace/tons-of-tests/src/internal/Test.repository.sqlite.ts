import * as SqlClient from 'effect/sql/SqlClient';
import {
    Array as A,
    Console,
    Effect,
    Option,
    Schema,
    SchemaTransformation,
    Stream,
} from 'effect';

import type {TestResult} from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {
    TestRun,
    type TestRepositoryShape,
    type TestResultRead,
    type TestResultSchemas,
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

const TestResultWriteSchema: Schema.Codec<TestResult, TestResultRead> =
    Schema.Struct({
        id: Schema.String,
        hashTestCase: Schema.String,
        key: Schema.String,
        ordering: Schema.Int,
        resultOrdering: Schema.Int,
        input: Schema.fromJsonString(Schema.Unknown),
        result: Schema.fromJsonString(Schema.Unknown),
        expected: Schema.fromJsonString(Schema.Unknown),
        label: LabelSchema,
        tags: split(','),
        timeMillis: Schema.Finite,
    });

const TestResultsSchema = Schema.Array(TestResultWriteSchema);

const CountSchema = Schema.Tuple([
    Schema.Struct({
        count: Schema.Int,
    }),
]).pipe(
    Schema.decodeTo(
        Schema.Int,
        SchemaTransformation.transform({
            decode: ([{count}]) => count,
            encode: count => [{count}],
        }),
    ),
);

const TestRunsReadSchema = Schema.Array(TestRun);

const TestRunResultsSchema = Schema.Array(
    Schema.Struct({
        testRun: Schema.Int,
        testResult: Schema.String,
        ordering: Schema.Int,
        resultOrdering: Schema.Int,
        timeMillis: Schema.Finite,
    }),
);

const TableColumnsSchema = Schema.Array(Schema.Struct({name: Schema.String}));

export const makeTestRepository = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`PRAGMA auto_vacuum = FULL;`;

    yield* sql.withTransaction(
        Effect.gen(function* () {
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
            key TEXT NOT NULL DEFAULT 'result',
            ordering INTEGER NOT NULL,
            resultOrdering INTEGER NOT NULL DEFAULT 0,
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
            ordering INTEGER NOT NULL,
            resultOrdering INTEGER NOT NULL,
            timeMillis INTEGER NOT NULL,
            FOREIGN KEY (testRun) REFERENCES ${sql(tables.testRuns)}(id),
            FOREIGN KEY (testResult) REFERENCES ${sql(tables.testResults)}(id),
            UNIQUE (testRun, testResult)
        );
    `;

            const resultColumns = yield* Schema.decodeUnknownEffect(
                TableColumnsSchema,
            )(yield* sql`PRAGMA table_info(${sql(tables.testResults)});`).pipe(
                Effect.mapError(
                    RepositoryDecodeError.from('migrateTestResults'),
                ),
            );
            if (!resultColumns.some(column => column.name === 'key')) {
                yield* sql`
            ALTER TABLE ${sql(tables.testResults)}
            ADD COLUMN key TEXT NOT NULL DEFAULT 'result';
        `;
            }
            if (
                !resultColumns.some(column => column.name === 'resultOrdering')
            ) {
                yield* sql`
            ALTER TABLE ${sql(tables.testResults)}
            ADD COLUMN resultOrdering INTEGER NOT NULL DEFAULT 0;
        `;
            }

            const runResultColumns = yield* Schema.decodeUnknownEffect(
                TableColumnsSchema,
            )(
                yield* sql`PRAGMA table_info(${sql(tables.testRunResults)});`,
            ).pipe(
                Effect.mapError(
                    RepositoryDecodeError.from('migrateTestRunResults'),
                ),
            );
            for (const column of ['ordering', 'resultOrdering', 'timeMillis']) {
                if (
                    runResultColumns.some(existing => existing.name === column)
                ) {
                    continue;
                }
                yield* sql`
            ALTER TABLE ${sql(tables.testRunResults)}
            ADD COLUMN ${sql(column)} INTEGER NOT NULL DEFAULT 0;
        `;
                yield* sql`
            UPDATE ${sql(tables.testRunResults)} AS runres
            SET ${sql(column)} = (
                SELECT ${sql(column)} FROM ${sql(tables.testResults)} res
                WHERE res.id = runres.testResult
            );
        `;
            }

            // Lookup by the junction's `testResult` column: the existing
            // UNIQUE(testRun, testResult) index is keyed on testRun first, so orphan
            // cleanup (`... NOT IN (SELECT testResult ...)`) and stream joins
            // (`res.id = runres.testResult`) would otherwise full-scan the junction.
            yield* sql`CREATE INDEX IF NOT EXISTS idx_trr_testresult ON ${sql(tables.testRunResults)}(testResult)`;
            yield* sql`CREATE INDEX IF NOT EXISTS idx_tr_hashtestcase ON ${sql(tables.testResults)}(hashTestCase)`;
        }),
    );

    // With 11 result columns and 5 junction columns, batches of 50 rows stay below
    // SQLite's lowest default limit of 999 bound values per statement.
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
                        Schema.encodeEffect(TestResultWriteSchema)(_).pipe(
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
                        ordering: _.ordering,
                        resultOrdering: _.resultOrdering,
                        timeMillis: _.timeMillis,
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
                        ON CONFLICT(testRun, testResult) DO UPDATE SET
                            ordering = excluded.ordering,
                            resultOrdering = excluded.resultOrdering,
                            timeMillis = excluded.timeMillis;
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
    ): Schema.Codec<TestResult<I, O, T>, TestResultRead> => {
        const input = (schemas?.input ?? Schema.Unknown) as Schema.Codec<I>;
        const result = (schemas?.result ?? Schema.Unknown) as Schema.Codec<O>;
        const expected = (schemas?.expected ??
            Schema.Unknown) as Schema.Codec<T>;

        return Schema.Struct({
            id: Schema.String,
            hashTestCase: Schema.String,
            key: Schema.String,
            ordering: Schema.Int,
            resultOrdering: Schema.Int,
            input: Schema.fromJsonString(input),
            result: Schema.fromJsonString(result),
            expected: Schema.fromJsonString(expected),
            label: LabelSchema,
            tags: split(','),
            timeMillis: Schema.Finite,
        });
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
        // The SQLite driver returns rows in one batch. Decode that batch once
        // before exposing it as a stream.
        return Stream.unwrap(
            Effect.gen(function* () {
                const rows = yield* sql`
                    SELECT res.id, res.hashTestCase, res.key,
                        runres.ordering, runres.resultOrdering,
                        res.input, res.result, res.expected, res.label, res.tags,
                        runres.timeMillis
                    FROM ${sql(tables.testResults)} res
                    JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult
                    JOIN ${sql(tables.testRuns)} runs ON runs.id = runres.testRun
                    WHERE runs.id = ${testRun.id}
                    ORDER BY runres.ordering ASC, runres.resultOrdering ASC;
                `.pipe(
                    Effect.mapError(
                        RepositoryQueryError.fromSql('getTestResultsStream'),
                    ),
                );
                const decoded = yield* Schema.decodeUnknownEffect(RowsSchema)(
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

    const hasResults = Effect.fnUntraced(function* (testRun: TestRun) {
        const b = yield* sql`
                SELECT COUNT(*) count FROM ${sql(tables.testRunResults)}
                WHERE testRun = ${testRun.id};
            `.pipe(Effect.mapError(RepositoryQueryError.fromSql('hasResults')));
        const r = yield* Schema.decodeUnknownEffect(CountSchema)(b).pipe(
            Effect.mapError(RepositoryDecodeError.from('hasResults')),
        );
        return r > 0;
    });

    const getPreviousTestRun = Effect.fnUntraced(function* (name: string) {
        const r = yield* sql`
                SELECT * FROM ${sql(tables.testRuns)}
                WHERE hash IS NOT NULL AND name = ${name}
                ORDER BY id DESC
                LIMIT 1;
            `.pipe(
            Effect.mapError(RepositoryQueryError.fromSql('getPreviousTestRun')),
        );
        const p = yield* Schema.decodeUnknownEffect(TestRunsReadSchema)(r).pipe(
            Effect.mapError(RepositoryDecodeError.from('getPreviousTestRun')),
        );
        return A.head(p);
    });

    const getAllTestRuns = Effect.gen(function* () {
        const results = yield* sql`
            SELECT * from ${sql(tables.testRuns)};
        `.pipe(Effect.mapError(RepositoryQueryError.fromSql('getAllTestRuns')));
        return yield* Schema.decodeUnknownEffect(TestRunsReadSchema)(
            results,
        ).pipe(Effect.mapError(RepositoryDecodeError.from('getAllTestRuns')));
    });

    const getAllTestRunResults = Effect.gen(function* () {
        const results = yield* sql`
            SELECT * from ${sql(tables.testRunResults)};
        `.pipe(
            Effect.mapError(
                RepositoryQueryError.fromSql('getAllTestRunResults'),
            ),
        );
        return yield* Schema.decodeUnknownEffect(TestRunResultsSchema)(
            results,
        ).pipe(
            Effect.mapError(RepositoryDecodeError.from('getAllTestRunResults')),
        );
    });

    const getAllTestResults = Effect.gen(function* () {
        const results = yield* sql`
            SELECT * from ${sql(tables.testResults)};
        `.pipe(
            Effect.mapError(RepositoryQueryError.fromSql('getAllTestResults')),
        );
        return yield* Schema.decodeUnknownEffect(TestResultsSchema)(
            results,
        ).pipe(
            Effect.mapError(RepositoryDecodeError.from('getAllTestResults')),
        );
    });

    const getLastTestRunHash = Effect.fnUntraced(function* (name: string) {
        const rows = yield* sql`
            SELECT *
            FROM ${sql(tables.testRuns)}
            WHERE hash IS NOT NULL AND name = ${name}
            ORDER BY id DESC
            LIMIT 1;
        `.pipe(
            Effect.mapError(RepositoryQueryError.fromSql('getLastTestRunHash')),
        );
        const runs = yield* Schema.decodeUnknownEffect(TestRunsReadSchema)(
            rows,
        ).pipe(
            Effect.mapError(RepositoryDecodeError.from('getLastTestRunHash')),
        );
        return A.head(runs).pipe(
            Option.flatMap(run => Option.fromNullishOr(run.hash)),
        );
    });

    const getOrCreateCurrentTestRun = (name: string) =>
        sql
            .withTransaction(
                Effect.gen(function* () {
                    const currentRaw = yield* sql`
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

                    const current = yield* Schema.decodeUnknownEffect(
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

                    const insertedRaw = yield* sql`
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

                    const inserted = yield* Schema.decodeUnknownEffect(
                        TestRunsReadSchema,
                    )(insertedRaw).pipe(
                        Effect.mapError(
                            RepositoryDecodeError.from(
                                'getOrCreateCurrentTestRun',
                            ),
                        ),
                    );

                    return yield* Effect.fromOption(A.head(inserted)).pipe(
                        Effect.mapError(
                            () => new TestRunNotCreated({testSuiteName: name}),
                        ),
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
                    const raw = yield* sql`
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

                    const staleTestRuns = yield* Schema.decodeUnknownEffect(
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
                    const currentRaw = yield* sql`
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

                    const current = yield* Schema.decodeUnknownEffect(
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

    const commitCurrentTestRun = Effect.fnUntraced(function* ({
        name,
        hash,
    }: {
        name: string;
        hash: string;
    }) {
        const currentTestRunResults = yield* Schema.decodeUnknownEffect(
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
            Effect.mapError(RepositoryDecodeError.from('commitCurrentTestRun')),
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
            Effect.mapError(RepositoryWriteError.from('commitCurrentTestRun')),
        );

        yield* sql`
                INSERT INTO ${sql(tables.testRuns)}
                ${sql.insert({name})};
            `.pipe(
            Effect.mapError(RepositoryWriteError.from('commitCurrentTestRun')),
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
