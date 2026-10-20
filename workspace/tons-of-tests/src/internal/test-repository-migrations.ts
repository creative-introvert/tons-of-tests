import {SqliteMigrator} from '@effect/sql-sqlite-node';
import {Effect} from 'effect';
import {SqlClient} from 'effect/sql';

export const tables = {
    testResults: 'test-results',
    testRuns: 'test-runs',
    testBaselines: 'test-baselines',
    testRunResults: 'test-run-results',
} as const;

export const migrate = SqliteMigrator.run({
    table: 'tons_of_tests_migrations',
    loader: SqliteMigrator.fromRecord({
        '001_create_tables': Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
                CREATE TABLE ${sql(tables.testRuns)}(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    variant TEXT NOT NULL,
                    state TEXT NOT NULL CHECK (state IN ('Running', 'Complete', 'Failed'))
                );
            `;
            yield* sql`CREATE INDEX idx_run_name_variant_id ON ${sql(tables.testRuns)}(name, variant, id);`;
            yield* sql`
                CREATE TABLE ${sql(tables.testBaselines)}(
                    name TEXT NOT NULL,
                    variant TEXT NOT NULL,
                    testRun INTEGER NOT NULL REFERENCES ${sql(tables.testRuns)}(id),
                    PRIMARY KEY (name, variant)
                );
            `;

            yield* sql`
                CREATE TABLE ${sql(tables.testResults)}(
                    id TEXT PRIMARY KEY,
                    hashTestCase TEXT NOT NULL,
                    key TEXT NOT NULL,
                    input TEXT,
                    result TEXT,
                    expected TEXT,
                    label TEXT NOT NULL
                );
            `;
            yield* sql`CREATE INDEX idx_tr_case_key ON ${sql(tables.testResults)}(hashTestCase, key);`;

            yield* sql`
                CREATE TABLE ${sql(tables.testRunResults)}(
                    testRun INTEGER NOT NULL,
                    testResult TEXT NOT NULL,
                    ordering INTEGER NOT NULL,
                    resultOrdering INTEGER NOT NULL,
                    timeMillis REAL NOT NULL,
                    tags TEXT NOT NULL,
                    FOREIGN KEY (testRun) REFERENCES ${sql(tables.testRuns)}(id),
                    FOREIGN KEY (testResult) REFERENCES ${sql(tables.testResults)}(id),
                    UNIQUE (testRun, testResult)
                );
            `;
            yield* sql`CREATE INDEX idx_trr_testresult ON ${sql(tables.testRunResults)}(testResult);`;
            yield* sql`CREATE INDEX idx_trr_run_order ON ${sql(tables.testRunResults)}(testRun, ordering, resultOrdering, testResult);`;
        }),
    }),
});
