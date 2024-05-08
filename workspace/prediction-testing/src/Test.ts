import type {Classify, Label, Stats} from './Classify.js';
import type * as P from './prelude.js';
import * as internal from './internal/Test.js';
import type {TestRun} from './Test.repository.js';

export type TestSuite<I = unknown, O = unknown, T = unknown> = {
    testCases: TestCase<I, T>[];
    program: Program<I, O>;
    classify?: Classify<O, T>;
    name: string;
};

export type TestCase<I, T> = {
    input: I;
    expected: T;
    tags?: string[];
};

export type Program<I, O> = (input: I) => P.Effect.Effect<O>;

export type TestResult<I = unknown, O = unknown, T = unknown> = {
    id: string;
    // Identifies the test case (input + expected).
    hashTestCase: string;
    ordering: number;
    label: Label;
    input: I;
    result: O;
    expected: T;
    tags: readonly string[];
};

export type TestRunResults<I = unknown, O = unknown, T = unknown> = TestRun & {
    testResultsByTestCaseHash: Record<string, TestResult<I, O, T>>;
    testCaseHashes: string[];
    stats: Stats;
};

export type Diff = Record<Label, number> & {
    precision: number;
    recall: number;
};

export type TestResultPredicate<I, O, T> = (args: {
    testResult: TestResult<I, O, T>;
    previousTestResult: P.Option.Option<TestResult<I, O, T>>;
}) => boolean;

export const all = internal.all;
export const diff = internal.diff;
export const runCollectRecord = internal.runCollectRecord;
