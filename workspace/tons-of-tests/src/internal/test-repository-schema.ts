import {Effect, Schema} from 'effect';
import type {SqlClient} from 'effect/sql';

import {RepositoryFormatError} from '../RepositoryError.js';

export const tables = {
    testResults: 'test-results',
    testRuns: 'test-runs',
    testBaselines: 'test-baselines',
    testRunResults: 'test-run-results',
} as const;

const format = {cache: 1414480721, snapshot: 1414480722};
const decodeVersion = Schema.decodeUnknownEffect(
    Schema.Tuple([Schema.Struct({user_version: Schema.Int})]),
);

export const checkFormat = Effect.fnUntraced(function* (
    sql: SqlClient.SqlClient,
    store: 'cache' | 'snapshot',
    path: string,
) {
    const [saved] = yield* decodeVersion(yield* sql`PRAGMA user_version;`);
    if (saved.user_version !== format[store]) {
        return yield* new RepositoryFormatError({store, path});
    }
});

/**
 * Initialize an empty store. Recheck its marker inside the transaction so another
 * process may finish initialization first. Existing formats are never upgraded.
 */
export const initializeSchema = Effect.fnUntraced(function* (
    sql: SqlClient.SqlClient,
    store: 'cache' | 'snapshot',
    path: string,
) {
    yield* sql.withTransaction(
        Effect.gen(function* () {
            const [saved] = yield* decodeVersion(
                yield* sql`PRAGMA user_version;`,
            );
            if (saved.user_version === format[store]) return;
            const existing = yield* sql`
                SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1;
            `;
            if (saved.user_version !== 0 || existing.length > 0) {
                return yield* new RepositoryFormatError({store, path});
            }
            yield* sql`
                CREATE TABLE ${sql(tables.testRuns)} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    executionId TEXT NOT NULL UNIQUE,
                    snapshotIdentity TEXT NOT NULL,
                    name TEXT NOT NULL,
                    variant TEXT NOT NULL,
                    state TEXT NOT NULL CHECK (state IN ('Running', 'Complete', 'Failed'))
                );
            `;
            yield* sql`CREATE INDEX idx_run_identity ON ${sql(tables.testRuns)} (snapshotIdentity, name, variant, id);`;
            if (store === 'cache') {
                yield* sql`CREATE UNIQUE INDEX idx_latest_attempt ON ${sql(tables.testRuns)} (snapshotIdentity, name, variant);`;
            }
            yield* sql`
                CREATE TABLE ${sql(tables.testBaselines)} (
                    name TEXT NOT NULL,
                    variant TEXT NOT NULL,
                    testRun INTEGER NOT NULL REFERENCES ${sql(tables.testRuns)}(id),
                    PRIMARY KEY (name, variant)
                );
            `;
            yield* sql`
                CREATE TABLE ${sql(tables.testResults)} (
                    id TEXT PRIMARY KEY,
                    hashTestCase TEXT NOT NULL,
                    key TEXT NOT NULL,
                    input TEXT NOT NULL,
                    result TEXT NOT NULL,
                    expected TEXT NOT NULL,
                    label TEXT NOT NULL
                );
            `;
            yield* sql`CREATE INDEX idx_tr_case_key ON ${sql(tables.testResults)}(hashTestCase, key);`;
            yield* sql`
                CREATE TABLE ${sql(tables.testRunResults)} (
                    testRun INTEGER NOT NULL REFERENCES ${sql(tables.testRuns)}(id) ON DELETE CASCADE,
                    testResult TEXT NOT NULL REFERENCES ${sql(tables.testResults)}(id),
                    ordering INTEGER NOT NULL,
                    resultOrdering INTEGER NOT NULL,
                    timeMillis REAL NOT NULL,
                    tags TEXT NOT NULL,
                    UNIQUE (testRun, testResult)
                );
            `;
            yield* sql`CREATE INDEX idx_trr_testresult ON ${sql(tables.testRunResults)}(testResult);`;
            yield* sql`CREATE INDEX idx_trr_run_order ON ${sql(tables.testRunResults)}(testRun, ordering, resultOrdering, testResult);`;
            yield* sql.unsafe(`PRAGMA user_version = ${format[store]};`);
        }),
    );
});
