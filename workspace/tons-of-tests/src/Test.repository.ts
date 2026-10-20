import * as Sqlite from '@effect/sql-sqlite-node';
import {
    Context,
    type Effect,
    Layer,
    type Option,
    type Schema,
    type Stream,
} from 'effect';

import type {Stats} from './Classify.js';
import {makeTestRepository} from './internal/Test.repository.sqlite.js';
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
 * Encode and decode saved input and evaluated values. Pass a suite's schemas
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
 * Saves attempts and a baseline for each variant in one database. This storage
 * format requires a fresh database; older formats are not migrated. Reads never
 * create runs. Saved history is not pruned automatically.
 */
export type TestRepositoryShape = {
    getTestResultsStream: <I = unknown, O = unknown, T = unknown>(
        testRun: TestRun,
        schemas: TestResultSchemas<I, O, T>,
        /** Match at most 50 case/key pairs per call. Results retain their saved order. */
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
    ) => Stream.Stream<TestResult<I, O, T>, RepositoryError>;
    /** Calculate exact statistics using temporary SQLite storage, released after use. */
    withStats: <A, E, R>(
        use: (collector: StatsCollector) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | RepositoryError, R>;
    /**
     * Create a new `Running` attempt and call `execute` once. The callback can be
     * interrupted. Save `Complete` after callback success, including empty runs.
     * Save `Failed` after a callback failure, synchronous throw, defect, or
     * interruption. Return success only after saving `Complete`.
     *
     * Database errors propagate. If execution and finalization both fail, preserve
     * both causes. A failed final write or abrupt process exit can leave the attempt
     * `Running`; it cannot be committed.
     */
    withTestRun: <A, E = never, R = never>(
        input: {name: string; variant: string},
        execute: (testRun: TestRun) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<{run: TestRun; value: A}, E | RepositoryError, R>;
    /** Find one saved attempt, including `Running` and `Failed` attempts. */
    getTestRun: (
        id: number,
    ) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /** Find the run with the greatest saved ID for this suite and variant, in any state. */
    getLatestTestRun: (input: {
        name: string;
        variant: string;
    }) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /** A missing baseline is `None`; it differs from a completed empty run. */
    getBaselineTestRun: (input: {
        name: string;
        variant: string;
    }) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /**
     * Set the baseline for this run's suite and variant to its exact run ID.
     * The run must be `Complete`; empty runs are allowed. Repeating a commit or
     * choosing an older run is allowed. Past runs and their results stay unchanged.
     */
    commitTestRun: (id: number) => Effect.Effect<void, RepositoryError>;
    /** List runs by descending ID. `limit` must be 1–100; the next page has `id < before`. */
    listTestRuns: (input: {
        name: string;
        variant?: string;
        before?: number;
        limit: number;
    }) => Effect.Effect<
        ReadonlyArray<TestRun & {readonly isBaseline: boolean}>,
        RepositoryError
    >;
    /** List every stored variant by name, with its saved baseline when one exists. */
    listVariantBaselines: (
        name: string,
    ) => Effect.Effect<
        ReadonlyArray<{variant: string; baseline: Option.Option<TestRun>}>,
        RepositoryError
    >;
    /** Only `Running` attempts accept writes; completed and failed runs cannot change. */
    insertTestResult: <I, O, T>(
        input: TestResult<I, O, T>,
        testRun: TestRun,
        schemas: TestResultSchemas<I, O, T>,
    ) => Effect.Effect<void, RepositoryError>;
    /** Check the saved state inside each batch transaction before writing. */
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
    static readonly layerNoDeps = Layer.effect(this, makeTestRepository);

    static layer(dbPath: string) {
        return Layer.provide(
            this.layerNoDeps,
            Sqlite.SqliteClient.layer({filename: dbPath}),
        );
    }

    static readonly TestLayer = Layer.provideMerge(
        this.layerNoDeps,
        Sqlite.SqliteClient.layer({filename: ':memory:'}),
    );
}
