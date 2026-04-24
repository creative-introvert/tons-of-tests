import {Effect, Option, type Schema} from 'effect';

import type {Classify, Label, Stats} from './Classify.js';
import * as internal from './internal/Test.js';
import type {TestRun} from './Test.repository.js';

export type TestSuiteSchemas<I, O, T> = {
    input: Schema.Schema<I>;
    result: Schema.Schema<O>;
    expected: Schema.Schema<T>;
};

export type TestSuite<
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
> = {
    testCases: TestCase<I, T>[];
    program: Program<I, O, E, R>;
    classify?: Classify<O, T>;
    name: string;
    // Optional per-suite schemas for input/result/expected. When present the
    // repository decodes cached rows through them so reads return
    // TestResult<I, O, T> honestly.
    schemas?: TestSuiteSchemas<I, O, T>;
};

export type TestCase<I, T> = {
    input: I;
    expected: T;
    tags?: string[];
};

export type Program<I, O, E = never, R = never> = (
    input: I,
) => Effect.Effect<O, E, R>;

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
    timeMillis: number;
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
    previousTestResult: Option.Option<TestResult<I, O, T>>;
}) => boolean;

export const all = internal.all;
export const diff = internal.diff;
export const makeSha256 = internal.makeSha256;
export const runCollectRecord = internal.runCollectRecord;
