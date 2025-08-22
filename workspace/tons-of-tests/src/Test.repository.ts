import type {ResultLengthMismatch, SqlError} from '@effect/sql/SqlError';
import type {Effect, Option, Stream} from 'effect';
import type {ParseError} from 'effect/ParseResult';

import type {Label} from './Classify.js';
import type {TestResult} from './Test.js';
import * as internal from './internal/Test.repository.sqlite.js';

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

export type TestRun = {
    id: number;
    name: string;
    hash: string | null;
};

export type TestRunResults = {
    testRun: number;
    testResult: string;
};

export type TestRepository = {
    clearStale: ({
        name,
        keep,
    }: {
        name: string;
        /**
         * How many previous test runs to keep.
         * @default 1
         */
        keep?: number;
    }) => Effect.Effect<void, SqlError | ParseError>;
    clearUncommitedTestResults: ({
        name,
    }: {name: string}) => Effect.Effect<void, SqlError | ParseError>;
    getTestResultsStream: (
        testRun: TestRun,
    ) => Stream.Stream<TestResult, SqlError | ParseError>;
    hasResults: (
        testRun: TestRun,
    ) => Effect.Effect<boolean, SqlError | ParseError>;
    getAllTestResults: Effect.Effect<
        readonly TestResult[],
        SqlError | ParseError
    >;
    getAllTestRuns: Effect.Effect<readonly TestRun[], SqlError | ParseError>;
    getAllTestRunResults: Effect.Effect<
        readonly TestRunResults[],
        SqlError | ParseError
    >;
    getLastTestRunHash: (
        name: string,
    ) => Effect.Effect<Option.Option<string>, SqlError>;
    getOrCreateCurrentTestRun: (
        name: string,
    ) => Effect.Effect<TestRun, SqlError>;
    getPreviousTestRun: (
        name: string,
    ) => Effect.Effect<Option.Option<TestRun>, SqlError | ParseError>;
    commitCurrentTestRun: (input: {
        name: string;
        hash: string;
    }) => Effect.Effect<void, SqlError | ParseError>;
    insertTestResult: (
        input: Omit<TestResult, 'createdAt'>,
        name: string,
    ) => Effect.Effect<void, ResultLengthMismatch | SqlError | ParseError>;
};
export const TestRepository = internal.TestRepository;
export const LiveLayer = internal.LiveLayer;
export const makeSqliteLiveLayer = internal.makeSqliteLiveLayer;
export const SqliteTestLayer = internal.SqliteTestLayer;
