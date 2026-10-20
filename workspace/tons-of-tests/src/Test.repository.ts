import {NodeServices} from '@effect/platform-node';
import {
    Context,
    Effect,
    Layer,
    type Option,
    type Schema,
    type Stream,
} from 'effect';
import {SqlClient} from 'effect/sql';

import type {Stats} from './Classify.js';
import {
    makeTestRepository,
    TestRepositoryStorage,
} from './internal/Test.repository.sqlite.js';
import type {RepositoryError} from './RepositoryError.js';
import type {TestResult} from './Test.js';
import type {TestRun} from './TestRun.js';

export {TestRun} from './TestRun.js';

type StatsCollector = {
    add: (
        results: ReadonlyArray<
            Pick<TestResult, 'hashTestCase' | 'label' | 'timeMillis'>
        >,
    ) => Effect.Effect<void, RepositoryError>;
    stats: Effect.Effect<Stats, RepositoryError>;
};

/**
 * Encode and decode stored input and evaluated values. Pass a suite's schemas
 * directly; its whole-case expectation is only needed by the runner.
 * Codecs must be deterministic, preserve equivalent values through JSON, and
 * require no Effect services.
 */
export type TestResultSchemas<I = unknown, O = unknown, T = unknown> = {
    testCase: {input: Schema.Codec<I, unknown>};
    evaluation: {
        result: Schema.Codec<O, unknown>;
        expected: Schema.Codec<T, unknown>;
    };
};

/**
 * Keeps only the latest attempt per snapshot identity, suite, and variant in a
 * disposable cache. A new attempt replaces the previous one, even if it later fails.
 * Only explicit commits write snapshots and baseline pointers. Saved snapshots
 * stay unchanged, and history is never pruned.
 *
 * Reading a missing snapshot file returns no saved runs without creating the file.
 * Unsupported snapshot formats fail without changing the file. Unsupported cache
 * formats are discarded. Neither store has upgrade migrations.
 */
export type TestRepositoryShape = {
    /**
     * Read the selected run in pages of 100 results. Cached reads keep the same rows
     * until the stream closes. If the attempt was already replaced, fail instead of
     * reading its successor.
     */
    getTestResultsStream: <I = unknown, O = unknown, T = unknown>(
        testRun: TestRun,
        schemas: TestResultSchemas<I, O, T>,
        /** Match at most 50 case/key pairs per call. Results keep their stored order. */
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
    ) => Stream.Stream<TestResult<I, O, T>, RepositoryError>;
    /** Calculate exact statistics in temporary cache tables, then release those tables. */
    withStats: <A, E, R>(
        use: (collector: StatsCollector) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | RepositoryError, R>;
    /**
     * Replace the latest cached attempt with a new `Running` attempt and call
     * `execute` once. The callback can be interrupted. Save `Complete` after callback
     * success, including empty runs.
     * Save `Failed` after a callback failure, synchronous throw, defect, or
     * interruption. Return success only after saving `Complete`.
     *
     * Database errors propagate. If execution and finalization both fail, preserve
     * both causes. A failed final write or abrupt process exit can leave the attempt
     * `Running`; it cannot be reused or committed.
     */
    withTestRun: <A, E = never, R = never>(
        input: {name: string; variant: string},
        execute: (testRun: TestRun) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<{run: TestRun; value: A}, E | RepositoryError, R>;
    /** Read an exact store and ID. A replaced cached attempt is missing. */
    getTestRun: (
        run: Pick<TestRun, 'store' | 'id'>,
    ) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /** Read the latest cached attempt in any state, including a complete empty run. */
    getLatestTestRun: (input: {
        name: string;
        variant: string;
    }) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /**
     * Read the selected snapshot without creating a missing snapshot file.
     * A missing baseline is `None`; a complete empty baseline is `Some`.
     */
    getBaselineTestRun: (input: {
        name: string;
        variant: string;
    }) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /**
     * Save the exact selected attempts and their baseline pointers in one snapshot
     * transaction. Return snapshots in selection order. Every selected attempt must
     * still exist and be `Complete` before a snapshot writer opens. Each suite and
     * variant may appear only once.
     *
     * Copy stored values, order, tags, and timing without running programs or codecs.
     * A failed transaction leaves all snapshots and baselines unchanged. Recommitting
     * an attempt reuses its execution UUID's snapshot. Selecting a saved snapshot
     * restores its baseline. The cache stays reusable after commit.
     *
     * Close file-backed snapshot writers before returning success, so copying the
     * snapshot file alone preserves the saved results.
     */
    commitTestRuns: (
        runs: readonly TestRun[],
    ) => Effect.Effect<readonly TestRun[], RepositoryError>;
    /**
     * List committed snapshots by descending ID, including removed variants.
     * `limit` must be 1–100; the next page has `id < before`.
     */
    listTestRuns: (input: {
        name: string;
        variant?: string;
        before?: number;
        limit: number;
    }) => Effect.Effect<
        ReadonlyArray<TestRun & {readonly isBaseline: boolean}>,
        RepositoryError
    >;
    /** List variants with committed history by name, with each selected baseline. */
    listVariantBaselines: (
        name: string,
    ) => Effect.Effect<
        ReadonlyArray<{variant: string; baseline: Option.Option<TestRun>}>,
        RepositoryError
    >;
    /** Only `Running` cached attempts accept writes. Complete and failed runs cannot change. */
    insertTestResult: <I, O, T>(
        input: TestResult<I, O, T>,
        testRun: TestRun,
        schemas: TestResultSchemas<I, O, T>,
    ) => Effect.Effect<void, RepositoryError>;
    /** Check the stored attempt's state inside each batch transaction before writing. */
    insertTestResults: <I, O, T>(
        inputs: ReadonlyArray<TestResult<I, O, T>>,
        testRun: TestRun,
        schemas: TestResultSchemas<I, O, T>,
    ) => Effect.Effect<void, RepositoryError>;
};

export class TestRepository extends Context.Service<
    TestRepository,
    TestRepositoryShape
>()('@creative-introvert/tons-of-tests/TestRepository') {
    /**
     * Keep cache rows separate by `snapshotIdentity`, even when repositories share a
     * cache filename. Cache and snapshot paths must refer to different files.
     * With `:memory:`, each store lasts for this layer's lifetime.
     * The caller supplies platform services; `CLI.buildLayer` also resolves paths.
     */
    static layer(options: {
        readonly dbPath: string;
        readonly cachePath: string;
        readonly snapshotIdentity: string;
    }) {
        return Layer.effect(
            this,
            makeTestRepository(options).pipe(
                Effect.map(({repository}) => repository),
            ),
        );
    }

    /** Use separate in-memory stores and platform services for isolated tests. */
    static readonly TestLayer = Layer.effectContext(
        Effect.gen(function* () {
            const stores = yield* makeTestRepository({
                dbPath: ':memory:',
                cachePath: ':memory:',
                snapshotIdentity: 'test',
            });
            return Context.make(TestRepository, stores.repository).pipe(
                Context.add(SqlClient.SqlClient, stores.cache),
                Context.add(TestRepositoryStorage, {snapshot: stores.snapshot}),
            );
        }),
    ).pipe(Layer.provide(NodeServices.layer));
}
