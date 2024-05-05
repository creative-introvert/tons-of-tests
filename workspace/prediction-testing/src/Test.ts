import type {Classify, Label, Stats} from './Classify.js';
import type * as P from './prelude.js';
import * as internal from './internal/Test.js';

export type TestSuite<I = unknown, O = unknown, T = unknown> = {
    testCases: TestCase<I, T>[];
    program: Program<I, O>;
    classify?: Classify<O, T>;
};

export type TestCase<I, T> = {
    input: I;
    expected: T;
    tags?: string[];
};

export type Program<I, O> = (input: I) => P.E.Effect<O>;

export type ID = string;

export type TestResult<I = unknown, O = unknown, T = unknown> = {
    id: ID;
    input: I;
    result: O;
    expected: T;
    label: Label;
    tags: Readonly<string[]>;
};

export type TestRun<I = unknown, O = unknown, T = unknown> = {
    testResultsById: Record<ID, TestResult<I, O, T>>;
    testResultIds: ID[];
    stats: Stats;
};

export type Diff = Record<Label, number> & {
    precision: number;
    recall: number;
};

export type TestResultPredicate<I, O, T> = (args: {
    testResult: TestResult<I, O, T>;
    previousTestResult: P.O.Option<TestResult<I, O, T>>;
}) => boolean;

export const all = internal.testAll;
export const runAll = internal.runAll;
export const runFoldEffect = internal.runFoldEffect;
export const diff = internal.diff;
export const TestRunSchema = internal.TestRunSchema;
