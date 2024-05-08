import type {Effect, Option, Stream} from 'effect';
import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import type {ParseError} from '@effect/schema/ParseResult';

import * as internal from './internal/Test.repository.sqlite.js';
import type {Label} from './Classify.js';
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
};

export type TestRun = {
    id: number;
    name: string;
    hash: string | null;
};

export type TestRepository = {
    clearTestRun: (testRun: TestRun) => Effect.Effect<void, SqlError>;
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
    getOrCreateCurrentTestRun: (
        name: string,
    ) => Effect.Effect<TestRun, SqlError>;
    getPreviousTestRun: (
        name: string,
    ) => Effect.Effect<Option.Option<TestRun>, SqlError | ParseError>;
    commitCurrentTestRun: (input: {
        name: string;
        hash: string;
    }) => Effect.Effect<void, SqlError>;
    insertTestResult: (
        input: Omit<TestResult, 'createdAt'>,
        name: string,
    ) => Effect.Effect<void, ResultLengthMismatch | SqlError | ParseError>;
};
export const TestRepository = internal.TestRepository;
export const LiveLayer = internal.LiveLayer;
export const makeSqliteLiveLayer = internal.makeSqliteLiveLayer;
export const SqliteTestLayer = internal.SqliteTestLayer;
