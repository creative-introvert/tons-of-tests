import {type Effect, type Option, Schema, type Stream} from 'effect';

import type {Label} from './Classify.js';
import type {RepositoryError} from './RepositoryError.js';
import type {TestResult} from './Test.js';

export type TestResultRead = {
    id: string;
    hashTestCase: string;
    ordering: number;
    label: Label;
    input: string;
    result: string;
    expected: string;
    tags: string;
    timeMillis: number;
};

export class TestRun extends Schema.Class<TestRun>('TestRun')({
    id: Schema.Int,
    name: Schema.String,
    hash: Schema.NullOr(Schema.String),
}) {}

export type TestRunResults = {
    testRun: number;
    testResult: string;
};

export type TestResultSchemas<I = unknown, O = unknown, T = unknown> = {
    input: Schema.Schema<I>;
    result: Schema.Schema<O>;
    expected: Schema.Schema<T>;
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
    ) => Stream.Stream<TestResult<I, O, T>, RepositoryError>;
    hasResults: (testRun: TestRun) => Effect.Effect<boolean, RepositoryError>;
    getAllTestResults: Effect.Effect<readonly TestResult[], RepositoryError>;
    getAllTestRuns: Effect.Effect<readonly TestRun[], RepositoryError>;
    getAllTestRunResults: Effect.Effect<
        readonly TestRunResults[],
        RepositoryError
    >;
    getLastTestRunHash: (
        name: string,
    ) => Effect.Effect<Option.Option<string>, RepositoryError>;
    getOrCreateCurrentTestRun: (
        name: string,
    ) => Effect.Effect<TestRun, RepositoryError>;
    getPreviousTestRun: (
        name: string,
    ) => Effect.Effect<Option.Option<TestRun>, RepositoryError>;
    commitCurrentTestRun: (input: {
        name: string;
        hash: string;
    }) => Effect.Effect<void, RepositoryError>;
    insertTestResult: (
        input: TestResult,
        testRun: TestRun,
    ) => Effect.Effect<void, RepositoryError>;
    insertTestResults: (
        inputs: ReadonlyArray<TestResult>,
        testRun: TestRun,
    ) => Effect.Effect<void, RepositoryError>;
};
