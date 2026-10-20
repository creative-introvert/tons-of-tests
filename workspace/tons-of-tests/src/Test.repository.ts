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

/** Decode stored input and evaluated values, including values from prior runs. */
export type TestResultSchemas<I = unknown, O = unknown, T = unknown> = {
    input: Schema.Codec<I>;
    result: Schema.Codec<O>;
    expected: Schema.Codec<T>;
};

export type TestRepositoryShape = {
    clearStale: ({
        name,
        keep,
    }: {
        name: string;
        keep?: number;
    }) => Effect.Effect<void, RepositoryError>;
    clearUncommitedTestResults: ({
        name,
    }: {
        name: string;
    }) => Effect.Effect<void, RepositoryError>;
    getTestResultsStream: <I = unknown, O = unknown, T = unknown>(
        testRun: TestRun,
        schemas?: TestResultSchemas<I, O, T>,
        /** Match at most 50 case/key pairs per call. Results retain their saved order. */
        matching?: ReadonlyArray<Pick<TestResult, 'hashTestCase' | 'key'>>,
    ) => Stream.Stream<TestResult<I, O, T>, RepositoryError>;
    /** Calculate exact statistics using temporary SQLite storage, released after use. */
    withStats: <A, E, R>(
        use: (collector: StatsCollector) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | RepositoryError, R>;
    /** Whether results are marked complete; empty successful executions also count. */
    isComplete: (testRun: TestRun) => Effect.Effect<boolean, RepositoryError>;
    /**
     * Replace current results and record success, failure, or interruption.
     * Passing a committed or stale run is a defect.
     */
    withTestRun: <A, E, R>(
        testRun: TestRun,
        execute: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | RepositoryError, R>;
    hasResults: (testRun: TestRun) => Effect.Effect<boolean, RepositoryError>;
    getLastTestRunHash: (
        name: string,
    ) => Effect.Effect<Option.Option<string>, RepositoryError>;
    getOrCreateCurrentTestRun: (
        name: string,
    ) => Effect.Effect<TestRun, RepositoryError>;
    getPreviousTestRun: (
        name: string,
    ) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    /** Save the current baseline atomically. Returns the outcome without printing. */
    commitCurrentTestRun: (input: {
        name: string;
        hash: string;
    }) => Effect.Effect<'Committed' | 'NothingToCommit', RepositoryError>;
    insertTestResult: (
        input: TestResult,
        testRun: TestRun,
    ) => Effect.Effect<void, RepositoryError>;
    insertTestResults: (
        inputs: ReadonlyArray<TestResult>,
        testRun: TestRun,
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
