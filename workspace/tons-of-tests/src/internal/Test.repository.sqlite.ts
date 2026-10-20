import * as Sqlite from '@effect/sql-sqlite-node';
import {
    Array as A,
    Context,
    Crypto,
    Effect,
    Exit,
    FileSystem,
    Layer,
    Option,
    Path,
    Ref,
    Schema,
    Scope,
    Semaphore,
    Stream,
    TxReentrantLock,
} from 'effect';
import {SqlClient} from 'effect/sql';
import type {PlatformError} from 'effect/PlatformError';

import type {TestResult} from '../Test.js';
import type {
    TestRepositoryShape,
    TestResultSchemas,
} from '../Test.repository.js';
import {TestRun} from '../TestRun.js';
import {
    type RepositoryError,
    RepositoryPathConflict,
    TestRunDuplicate,
    TestRunIncomplete,
    TestRunNotCreated,
    TestRunNotFound,
} from '../RepositoryError.js';
import {LabelSchema} from './Classify.js';
import {
    checkFormat,
    initializeSchema,
    tables,
} from './test-repository-schema.js';
import {withStats} from './test-result-stats.js';
import {makeResultCodec, stringifyJson} from './Test.serialization.js';

export {tables} from './test-repository-schema.js';

export class TestRepositoryStorage extends Context.Service<
    TestRepositoryStorage,
    {readonly snapshot: Effect.Effect<SqlClient.SqlClient, RepositoryError>}
>()('@creative-introvert/tons-of-tests/internal/TestRepositoryStorage') {}

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
const RawResult = StoredResult.mapFields(fields => ({
    ...fields,
    tags: Schema.String,
}));
const StoredRun = Schema.Union([
    TestRun.members[0].pipe(Schema.fieldsAssign({executionId: Schema.String})),
    TestRun.members[1].pipe(Schema.fieldsAssign({executionId: Schema.String})),
]);
const encodeResult = Schema.encodeEffect(StoredResult);
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(StoredResult));
const decodeRawRows = Schema.decodeUnknownEffect(Schema.Array(RawResult));
const decodeRuns = Schema.decodeUnknownEffect(Schema.Array(TestRun));
const decodeStoredRuns = Schema.decodeUnknownEffect(Schema.Array(StoredRun));
const decodeListedRuns = Schema.decodeUnknownEffect(
    Schema.Array(
        TestRun.members[1].pipe(
            Schema.fieldsAssign({isBaseline: Schema.Literals([0, 1])}),
        ),
    ),
);
const decodeVariantBaselines = Schema.decodeUnknownEffect(
    Schema.Array(
        Schema.Struct({
            variant: Schema.String,
            id: Schema.NullOr(Schema.Int),
            name: Schema.NullOr(Schema.String),
            state: Schema.NullOr(Schema.Literal('Complete')),
        }),
    ),
);
const decodeRunLimit = Schema.decodeUnknownEffect(
    Schema.Int.check(Schema.isBetween({minimum: 1, maximum: 100})),
);

const openClient = (options: Sqlite.SqliteClient.SqliteClientConfig) =>
    Layer.build(Sqlite.SqliteClient.layer(options)).pipe(
        Effect.map(Context.get(SqlClient.SqlClient)),
    );

type Options = {
    readonly dbPath: string;
    readonly cachePath: string;
    readonly snapshotIdentity: string;
};

export const makeTestRepository = Effect.fnUntraced(function* (
    options: Options,
) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const lifetime = yield* Effect.scope;
    const memoryLock = yield* TxReentrantLock.make();
    const snapshotLock = yield* Semaphore.make(1);
    const snapshotMemory = yield* Ref.make(Option.none<SqlClient.SqlClient>());

    const canonicalPath = (
        filename: string,
    ): Effect.Effect<string, PlatformError> =>
        fs.realPath(filename).pipe(
            Effect.catchTag('PlatformError', error => {
                if (error.reason._tag !== 'NotFound') return Effect.fail(error);
                const parent = path.dirname(filename);
                if (parent === filename) return Effect.fail(error);
                return Effect.gen(function* () {
                    const link = yield* fs.readLink(filename).pipe(
                        Effect.asSome,
                        Effect.catchReason(
                            'PlatformError',
                            'NotFound',
                            () => Effect.succeedNone,
                        ),
                    );
                    return Option.isSome(link)
                        ? yield* canonicalPath(path.resolve(parent, link.value))
                        : path.join(
                              yield* canonicalPath(parent),
                              path.basename(filename),
                          );
                });
            }),
        );

    if (options.dbPath !== ':memory:' && options.cachePath !== ':memory:') {
        const [snapshotFile, cacheFile] = yield* Effect.all([
            canonicalPath(options.dbPath),
            canonicalPath(options.cachePath),
        ]);
        const [snapshotInfo, cacheInfo] = yield* Effect.forEach(
            [snapshotFile, cacheFile],
            filename =>
                fs.stat(filename).pipe(
                    Effect.asSome,
                    Effect.catchReason(
                        'PlatformError',
                        'NotFound',
                        () => Effect.succeedNone,
                    ),
                ),
        );
        const sameInode =
            Option.isSome(snapshotInfo) &&
            Option.isSome(cacheInfo) &&
            snapshotInfo.value.dev === cacheInfo.value.dev &&
            Option.isSome(snapshotInfo.value.ino) &&
            Option.isSome(cacheInfo.value.ino) &&
            snapshotInfo.value.ino.value === cacheInfo.value.ino.value;
        if (snapshotFile === cacheFile || sameInode) {
            return yield* new RepositoryPathConflict({
                snapshotPath: options.dbPath,
                cachePath: options.cachePath,
            });
        }
    }

    let initializeCache = options.cachePath === ':memory:';
    if (options.cachePath !== ':memory:') {
        yield* fs.makeDirectory(path.dirname(options.cachePath), {
            recursive: true,
        });
        initializeCache = !(yield* fs.exists(options.cachePath));
        if (!initializeCache) {
            const compatible = yield* Effect.scoped(
                Effect.gen(function* () {
                    const sql = yield* openClient({
                        filename: options.cachePath,
                        readonly: true,
                        disableWAL: true,
                    });
                    yield* checkFormat(sql, 'cache', options.cachePath);
                    return true;
                }),
            ).pipe(
                Effect.catchTag('RepositoryFormatError', () =>
                    Effect.succeed(false),
                ),
            );
            if (!compatible) {
                for (const suffix of ['', '-wal', '-shm']) {
                    yield* fs.remove(`${options.cachePath}${suffix}`, {
                        force: true,
                    });
                }
                initializeCache = true;
            }
        }
    }
    const cache = yield* openClient({filename: options.cachePath});
    yield* cache`PRAGMA foreign_keys = ON;`;
    if (initializeCache)
        yield* initializeSchema(cache, 'cache', options.cachePath);

    const getMemorySnapshot = snapshotLock.withPermit(
        Effect.gen(function* () {
            const existing = yield* Ref.get(snapshotMemory);
            if (Option.isSome(existing)) return existing.value;
            const sql = yield* Scope.provide(
                openClient({filename: ':memory:', disableWAL: true}),
                lifetime,
            );
            yield* sql`PRAGMA foreign_keys = ON;`;
            yield* initializeSchema(sql, 'snapshot', ':memory:');
            yield* Ref.set(snapshotMemory, Option.some(sql));
            return sql;
        }),
    );

    const snapshotReader = Effect.gen(function* () {
        if (options.dbPath === ':memory:')
            return yield* Ref.get(snapshotMemory);
        if (!(yield* fs.exists(options.dbPath)))
            return Option.none<SqlClient.SqlClient>();
        const sql = yield* openClient({
            filename: options.dbPath,
            readonly: true,
            disableWAL: true,
        });
        yield* checkFormat(sql, 'snapshot', options.dbPath);
        return Option.some(sql);
    });

    const withSnapshot = <A, E, R>(
        empty: A,
        use: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, R>,
    ) =>
        Effect.scoped(
            Effect.gen(function* () {
                const sql = yield* snapshotReader;
                return Option.isSome(sql) ? yield* use(sql.value) : empty;
            }),
        );

    const cacheReader = Effect.gen(function* () {
        if (options.cachePath === ':memory:') {
            // A memory store has one connection. Block writes to attempts while
            // readers page through them; temporary statistics remain writable.
            yield* TxReentrantLock.readLock(memoryLock);
            return cache;
        }
        const sql = yield* openClient({
            filename: options.cachePath,
            readonly: true,
            disableWAL: true,
        });
        // Keep the selected rows stable until the scoped connection closes,
        // including when reading is interrupted.
        yield* sql`BEGIN;`;
        return sql;
    });

    const writeCache = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        options.cachePath === ':memory:'
            ? TxReentrantLock.withWriteLock(
                  memoryLock,
                  cache.withTransaction(effect),
              )
            : cache.withTransaction(effect);

    const readRun = Effect.fnUntraced(function* (
        sql: SqlClient.SqlClient,
        run: Pick<TestRun, 'store' | 'id'>,
    ) {
        return A.head(
            yield* decodeRuns(
                yield* sql`
            SELECT *, ${run.store} AS store FROM ${sql(tables.testRuns)}
            WHERE id = ${run.id}
                AND ${run.store === 'cache' ? sql`snapshotIdentity = ${options.snapshotIdentity}` : sql`1 = 1`};
        `,
            ),
        );
    });

    const getTestRun: TestRepositoryShape['getTestRun'] = run =>
        run.store === 'cache'
            ? readRun(cache, run)
            : withSnapshot(Option.none<TestRun>(), sql => readRun(sql, run));

    const requireRun = Effect.fnUntraced(function* (
        sql: SqlClient.SqlClient,
        run: TestRun,
    ) {
        const found = yield* readRun(sql, run);
        if (
            Option.isNone(found) ||
            found.value.name !== run.name ||
            found.value.variant !== run.variant
        ) {
            return yield* new TestRunNotFound({testRunId: run.id});
        }
        return found.value;
    });

    const writeRows = Effect.fnUntraced(function* (
        sql: SqlClient.SqlClient,
        runId: number,
        rows: ReadonlyArray<typeof RawResult.Type>,
    ) {
        if (rows.length === 0) return;
        yield* sql`
            INSERT INTO ${sql(tables.testResults)} ${sql.insert(
                rows.map(row => ({
                    id: row.id,
                    hashTestCase: row.hashTestCase,
                    key: row.key,
                    input: row.input,
                    result: row.result,
                    expected: row.expected,
                    label: row.label,
                })),
            )} ON CONFLICT(id) DO NOTHING;
        `;
        yield* sql`
            INSERT INTO ${sql(tables.testRunResults)} ${sql.insert(
                rows.map(row => ({
                    testRun: runId,
                    testResult: row.id,
                    ordering: row.ordering,
                    resultOrdering: row.resultOrdering,
                    timeMillis: row.timeMillis,
                    tags: row.tags,
                })),
            )} ON CONFLICT(testRun, testResult) DO UPDATE SET
                ordering = excluded.ordering, resultOrdering = excluded.resultOrdering,
                timeMillis = excluded.timeMillis, tags = excluded.tags;
        `;
    });

    const insertTestResults = Effect.fnUntraced(function* <I, O, T>(
        results: ReadonlyArray<TestResult<I, O, T>>,
        run: TestRun,
        schemas: TestResultSchemas<I, O, T>,
    ) {
        if (run.store !== 'cache') {
            return yield* Effect.die(
                new Error('Only cached Running attempts accept result writes.'),
            );
        }
        const codec = makeResultCodec(schemas, run.name);
        // Fifty rows keep every statement below SQLite's 999-parameter minimum.
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
            yield* writeCache(
                Effect.gen(function* () {
                    const saved = yield* requireRun(cache, run);
                    if (saved.state !== 'Running') {
                        return yield* Effect.die(
                            new Error(
                                'Only Running test runs accept result writes.',
                            ),
                        );
                    }
                    yield* writeRows(cache, run.id, encoded);
                }),
            );
        }
    });

    const readResultPage = (
        sql: SqlClient.SqlClient,
        runId: number,
        after:
            | Pick<TestResult, 'ordering' | 'resultOrdering' | 'id'>
            | undefined,
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
        limit = 100,
    ) => {
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
        // CROSS JOIN makes matching batches use the case/key index first.
        const from =
            matching === undefined
                ? sql`${sql(tables.testRunResults)} runres JOIN ${sql(tables.testResults)} res ON res.id = runres.testResult`
                : sql`${sql(tables.testResults)} res CROSS JOIN ${sql(tables.testRunResults)} runres ON res.id = runres.testResult`;
        return sql`
            SELECT res.id, res.hashTestCase, res.key, runres.ordering, runres.resultOrdering,
                res.input, res.result, res.expected, res.label, runres.tags, runres.timeMillis
            FROM ${from}
            WHERE runres.testRun = ${runId} AND ${filter}
                AND ${
                    after === undefined
                        ? sql`1 = 1`
                        : sql`
                    (runres.ordering, runres.resultOrdering, runres.testResult) >
                    (${after.ordering}, ${after.resultOrdering}, ${after.id})`
                }
            ORDER BY runres.ordering, runres.resultOrdering, runres.testResult LIMIT ${limit};
        `;
    };

    const getTestResultsStream: TestRepositoryShape['getTestResultsStream'] = (
        run,
        schemas,
        matching,
    ) => {
        if (matching !== undefined && matching.length > 50)
            return Stream.die(
                new Error('Match at most 50 case/key pairs per query.'),
            );
        const codec = makeResultCodec(schemas, run.name);
        return Stream.unwrap(
            Effect.gen(function* () {
                const selected =
                    run.store === 'cache'
                        ? Option.some(yield* cacheReader)
                        : yield* snapshotReader;
                if (Option.isNone(selected))
                    return yield* new TestRunNotFound({testRunId: run.id});
                const sql = selected.value;
                yield* requireRun(sql, run);
                return Stream.paginate(
                    undefined,
                    Effect.fnUntraced(function* (
                        after:
                            | Pick<
                                  TestResult,
                                  'ordering' | 'resultOrdering' | 'id'
                              >
                            | undefined,
                    ) {
                        const rows = yield* decodeRows(
                            yield* readResultPage(sql, run.id, after, matching),
                        );
                        const decoded = yield* Effect.forEach(
                            rows,
                            codec.decode,
                        );
                        return [
                            decoded,
                            rows.length < 100
                                ? Option.none()
                                : Option.some(rows[rows.length - 1]),
                        ] as const;
                    }),
                );
            }),
        );
    };

    const getLatestTestRun: TestRepositoryShape['getLatestTestRun'] =
        Effect.fnUntraced(function* ({name, variant}) {
            return A.head(
                yield* decodeRuns(
                    yield* cache`
            SELECT *, 'cache' AS store FROM ${cache(tables.testRuns)}
            WHERE snapshotIdentity = ${options.snapshotIdentity} AND name = ${name} AND variant = ${variant}
            ORDER BY id DESC LIMIT 1;
        `,
                ),
            );
        });

    const getBaselineTestRun: TestRepositoryShape['getBaselineTestRun'] = ({
        name,
        variant,
    }) =>
        withSnapshot(
            Option.none<TestRun>(),
            Effect.fnUntraced(function* (sql) {
                return A.head(
                    yield* decodeRuns(
                        yield* sql`
                SELECT run.*, 'snapshot' AS store FROM ${sql(tables.testBaselines)} baseline
                JOIN ${sql(tables.testRuns)} run ON run.id = baseline.testRun
                WHERE baseline.name = ${name} AND baseline.variant = ${variant};
            `,
                    ),
                );
            }),
        );

    const createTestRun = Effect.fnUntraced(function* (input: {
        name: string;
        variant: string;
    }) {
        const executionId = yield* crypto.randomUUIDv4();
        return yield* writeCache(
            Effect.gen(function* () {
                yield* cache`
                DELETE FROM ${cache(tables.testRuns)}
                WHERE snapshotIdentity = ${options.snapshotIdentity} AND name = ${input.name} AND variant = ${input.variant};
            `;
                yield* cache`
                DELETE FROM ${cache(tables.testResults)} WHERE NOT EXISTS (
                    SELECT 1 FROM ${cache(tables.testRunResults)} links WHERE links.testResult = ${cache(tables.testResults)}.id
                );
            `;
                const inserted = yield* decodeRuns(
                    yield* cache`
                INSERT INTO ${cache(tables.testRuns)} ${cache.insert({name: input.name, variant: input.variant, executionId, snapshotIdentity: options.snapshotIdentity, state: 'Running'})}
                RETURNING *, 'cache' AS store;
            `,
                );
                return yield* Effect.fromOption(A.head(inserted)).pipe(
                    Effect.mapError(
                        () =>
                            new TestRunNotCreated({testSuiteName: input.name}),
                    ),
                );
            }),
        );
    });

    const finishTestRun = (run: TestRun, state: 'Complete' | 'Failed') =>
        writeCache(
            Effect.gen(function* () {
                const updated = yield* decodeRuns(
                    yield* cache`
            UPDATE ${cache(tables.testRuns)} SET state = ${state}
            WHERE id = ${run.id} AND snapshotIdentity = ${options.snapshotIdentity} AND state = 'Running'
            RETURNING *, 'cache' AS store;
        `,
                );
                if (updated.length === 0)
                    return yield* new TestRunNotFound({testRunId: run.id});
            }),
        );

    const withTestRun: TestRepositoryShape['withTestRun'] = (input, execute) =>
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
                run: TestRun.make({...run, state: 'Complete'}),
                value,
            })),
        );

    const snapshotWriter = Effect.gen(function* () {
        if (options.dbPath === ':memory:') return yield* getMemorySnapshot;
        const exists = yield* fs.exists(options.dbPath);
        if (exists) {
            yield* Effect.scoped(
                Effect.gen(function* () {
                    const sql = yield* openClient({
                        filename: options.dbPath,
                        readonly: true,
                        disableWAL: true,
                    });
                    yield* checkFormat(sql, 'snapshot', options.dbPath);
                }),
            );
        } else {
            yield* fs.makeDirectory(path.dirname(options.dbPath), {
                recursive: true,
            });
        }
        const sql = yield* openClient({
            filename: options.dbPath,
            disableWAL: true,
        });
        if (exists) yield* checkFormat(sql, 'snapshot', options.dbPath);
        else yield* initializeSchema(sql, 'snapshot', options.dbPath);
        yield* sql`PRAGMA journal_mode = DELETE;`;
        yield* sql`PRAGMA foreign_keys = ON;`;
        return sql;
    });

    const commitTestRuns: TestRepositoryShape['commitTestRuns'] = runs =>
        Effect.scoped(
            Effect.gen(function* () {
                if (runs.length === 0) return [];
                const selectedVariants = new Set<string>();
                for (const run of runs) {
                    const key = JSON.stringify([run.name, run.variant]);
                    if (selectedVariants.has(key))
                        return yield* new TestRunDuplicate({
                            testSuiteName: run.name,
                            variant: run.variant,
                        });
                    selectedVariants.add(key);
                }
                const reader = runs.some(run => run.store === 'cache')
                    ? yield* cacheReader
                    : undefined;
                // Check every selected run before opening a writer, so a missing or
                // incomplete attempt cannot create a snapshot file.
                const selected = yield* Effect.forEach(runs, run =>
                    Effect.gen(function* () {
                        const saved =
                            run.store === 'cache' && reader !== undefined
                                ? yield* requireRun(reader, run)
                                : yield* getTestRun(run).pipe(
                                      Effect.flatMap(
                                          Option.match({
                                              onNone: () =>
                                                  Effect.fail(
                                                      new TestRunNotFound({
                                                          testRunId: run.id,
                                                      }),
                                                  ),
                                              onSome: Effect.succeed,
                                          }),
                                      ),
                                  );
                        if (
                            saved.name !== run.name ||
                            saved.variant !== run.variant
                        )
                            return yield* new TestRunNotFound({
                                testRunId: run.id,
                            });
                        if (saved.state !== 'Complete')
                            return yield* new TestRunIncomplete({
                                testSuiteName: saved.name,
                                testRunId: saved.id,
                                variant: saved.variant,
                            });
                        if (saved.store === 'snapshot' || reader === undefined)
                            return {run: saved, executionId: undefined};
                        const stored = yield* decodeStoredRuns(
                            yield* reader`
                SELECT *, 'cache' AS store FROM ${reader(tables.testRuns)}
                WHERE id = ${saved.id} AND snapshotIdentity = ${options.snapshotIdentity};
            `,
                        );
                        return {run: saved, executionId: stored[0].executionId};
                    }),
                );
                const sql = yield* snapshotWriter;
                return yield* sql.withTransaction(
                    Effect.forEach(selected, ({run, executionId}) =>
                        Effect.gen(function* () {
                            let snapshot: TestRun;
                            if (run.store === 'snapshot') {
                                snapshot = yield* requireRun(sql, run);
                            } else {
                                const existing = yield* decodeRuns(
                                    yield* sql`
                    SELECT *, 'snapshot' AS store FROM ${sql(tables.testRuns)} WHERE executionId = ${executionId};
                `,
                                );
                                if (existing.length > 0) {
                                    snapshot = existing[0];
                                } else {
                                    const inserted = yield* decodeRuns(
                                        yield* sql`
                        INSERT INTO ${sql(tables.testRuns)} ${sql.insert({
                            name: run.name,
                            variant: run.variant,
                            executionId,
                            snapshotIdentity: options.snapshotIdentity,
                            state: 'Complete',
                        })} RETURNING *, 'snapshot' AS store;
                    `,
                                    );
                                    snapshot = inserted[0];
                                    let after:
                                        | Pick<
                                              TestResult,
                                              | 'ordering'
                                              | 'resultOrdering'
                                              | 'id'
                                          >
                                        | undefined;
                                    if (reader !== undefined) {
                                        while (true) {
                                            const rows = yield* decodeRawRows(
                                                yield* readResultPage(
                                                    reader,
                                                    run.id,
                                                    after,
                                                    undefined,
                                                    50,
                                                ),
                                            );
                                            yield* writeRows(
                                                sql,
                                                snapshot.id,
                                                rows,
                                            );
                                            if (rows.length < 50) break;
                                            after = rows[rows.length - 1];
                                        }
                                    }
                                }
                            }
                            yield* sql`
                INSERT INTO ${sql(tables.testBaselines)} ${sql.insert({name: snapshot.name, variant: snapshot.variant, testRun: snapshot.id})}
                ON CONFLICT(name, variant) DO UPDATE SET testRun = excluded.testRun;
            `;
                            return snapshot;
                        }),
                    ),
                );
            }),
        );

    const listTestRuns: TestRepositoryShape['listTestRuns'] = Effect.fnUntraced(
        function* ({name, variant, before, limit}) {
            const parsedLimit = yield* decodeRunLimit(limit);
            return yield* withSnapshot<
                ReadonlyArray<TestRun & {readonly isBaseline: boolean}>,
                RepositoryError,
                never
            >(
                [],
                Effect.fnUntraced(function* (sql) {
                    const rows = yield* decodeListedRuns(
                        yield* sql`
                SELECT run.*, 'snapshot' AS store, EXISTS (
                    SELECT 1 FROM ${sql(tables.testBaselines)} baseline
                    WHERE baseline.name = run.name AND baseline.variant = run.variant AND baseline.testRun = run.id
                ) AS isBaseline FROM ${sql(tables.testRuns)} run
                WHERE run.name = ${name}
                    AND ${variant === undefined ? sql`1 = 1` : sql`run.variant = ${variant}`}
                    AND ${before === undefined ? sql`1 = 1` : sql`run.id < ${before}`}
                ORDER BY run.id DESC LIMIT ${parsedLimit};
            `,
                    );
                    return rows.map(({isBaseline, ...run}) => ({
                        ...run,
                        isBaseline: isBaseline === 1,
                    }));
                }),
            );
        },
    );

    const listVariantBaselines: TestRepositoryShape['listVariantBaselines'] =
        name =>
            withSnapshot<
                ReadonlyArray<{
                    variant: string;
                    baseline: Option.Option<TestRun>;
                }>,
                RepositoryError,
                never
            >(
                [],
                Effect.fnUntraced(function* (sql) {
                    const rows = yield* decodeVariantBaselines(
                        yield* sql`
            SELECT variants.variant, run.id, run.name, run.state FROM (
                SELECT DISTINCT variant FROM ${sql(tables.testRuns)} WHERE name = ${name}
            ) variants LEFT JOIN ${sql(tables.testBaselines)} baseline
                ON baseline.name = ${name} AND baseline.variant = variants.variant
            LEFT JOIN ${sql(tables.testRuns)} run ON run.id = baseline.testRun ORDER BY variants.variant;
        `,
                    );
                    return rows.map(({variant, id, name}) => ({
                        variant,
                        baseline:
                            id === null || name === null
                                ? Option.none<TestRun>()
                                : Option.some(
                                      TestRun.make({
                                          id,
                                          name,
                                          variant,
                                          store: 'snapshot',
                                          state: 'Complete',
                                      }),
                                  ),
                    }));
                }),
            );

    const repository = {
        commitTestRuns,
        getTestRun,
        getLatestTestRun,
        getBaselineTestRun,
        listTestRuns,
        listVariantBaselines,
        getTestResultsStream,
        withTestRun,
        withStats: use =>
            withStats(use).pipe(
                Effect.provideService(SqlClient.SqlClient, cache),
            ),
        insertTestResult: (result, run, schemas) =>
            insertTestResults([result], run, schemas),
        insertTestResults,
    } satisfies TestRepositoryShape;
    return {repository, cache, snapshot: getMemorySnapshot};
});
