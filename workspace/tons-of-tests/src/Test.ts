import {type Array, Effect, Option, type Stream} from 'effect';

import type {Label, Stats} from './Classify.js';
import * as internal from './internal/Test.js';
import type {TestRun, TestResultSchemas} from './Test.repository.js';

export type TestSuiteSchemas<I, O, T> = TestResultSchemas<I, O, T>;

export type TestCases<I, T, E = never, R = never> =
    | ReadonlyArray<TestCase<I, T>>
    | Stream.Stream<TestCase<I, T>, E, R>;

export type EvaluationResult<A, B> = {
    /** Non-empty and unique within the case. Keep it stable across runs. */
    readonly key: string;
    readonly result: A;
    readonly expected: B;
    readonly label: Label;
};

/**
 * Returns the results to track for one completed output. Keep this function pure.
 * Return at least one result, in display order. Each key must be non-empty and
 * unique within the case.
 */
export type Evaluate<O, T, A = O, B = T> = (
    output: O,
    expected: T,
) => Array.NonEmptyReadonlyArray<EvaluationResult<A, B>>;

/**
 * Runs `program` once per case, then evaluates its output. `O` and `T` describe
 * the whole output and expected value; `A` and `B` describe the evaluated values.
 * Without `evaluate`, the default comparison returns one result with key `result`.
 */
export type TestSuite<
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
    A = O,
    B = T,
> = {
    name: string;
    /** Decode cached input and the result/expected values returned by `evaluate`. */
    schemas?: TestSuiteSchemas<I, A, B>;
} & (
    | {
          testCases: TestCases<I, T, E, R>;
          program: Program<I, O, E, R>;
          evaluate: Evaluate<O, T, A, B>;
      }
    | {
          testCases: TestCases<I, T & NoInfer<B>, E, R>;
          program: Program<I, O & NoInfer<A>, E, R>;
          evaluate?: undefined;
      }
);

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
    /** Hash of the original input and expected value, shared by all case results. */
    hashTestCase: string;
    key: string;
    /** Zero-based position of the case in the suite. */
    ordering: number;
    /** Zero-based position of the result in the case's evaluation array. */
    resultOrdering: number;
    label: Label;
    input: I;
    result: O;
    expected: T;
    tags: readonly string[];
    /** Program duration for the case, shared by all its results. */
    timeMillis: number;
};

export type TestRunResults<I = unknown, O = unknown, T = unknown> = TestRun & {
    /** Indexed by `resultKey`, which combines the case hash and evaluation key. */
    testResultsByKey: Record<string, TestResult<I, O, T>>;
    /** Keys into `testResultsByKey`, in display order. */
    testResultKeys: string[];
    /** Distinct case hashes, in display order. */
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
/** Builds the lookup key for one evaluation within its original test case. */
export const resultKey = internal.resultKey;
export const runCollectRecord = internal.runCollectRecord;
/** Keeps matching results and recalculates counts and case timing statistics. */
export const filterResults = internal.filterResults;
