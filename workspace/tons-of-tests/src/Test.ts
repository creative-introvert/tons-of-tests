import {
    type Array,
    type Effect,
    type Option,
    Schema,
    type Stream,
} from 'effect';

import type {Label, Stats} from './Classify.js';
import * as internal from './internal/Test.js';
import type {TestRun, TestResultSchemas} from './Test.repository.js';

/** Codecs must encode deterministically and preserve values through JSON. */
export type TestSuiteSchemas<I, T, A, B> = TestResultSchemas<I, A, B> & {
    testCase: {
        expected: Schema.Codec<T, unknown>;
    };
};

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

export type TestSuitePrograms<I, O, E, R> =
    | {program: Program<I, O, E, R>; variants?: never}
    | {
          program?: never;
          variants: Readonly<Record<string, {program: Program<I, O, E, R>}>>;
      };

type SuiteProgram<S> = S extends {program: infer P}
    ? P
    : S extends {variants: infer V}
      ? V[keyof V] extends {program: infer P}
          ? P
          : never
      : never;

type ProgramEffect<S> =
    SuiteProgram<S> extends (...args: never[]) => infer F ? F : never;

/** Errors from every configured program and from the case stream. */
export type TestSuiteError<S> =
    | Effect.Error<ProgramEffect<S>>
    | Stream.Error<S extends {testCases: infer C} ? C : never>;

/** Callers provide all services used by any program or the case stream. */
export type TestSuiteServices<S> =
    | Effect.Services<ProgramEffect<S>>
    | Stream.Services<S extends {testCases: infer C} ? C : never>;

/**
 * Keep source effect types. Skip `evaluate` during inference so the suite supplies
 * its callback parameter types.
 */
export type InferTestSuite<S> = {
    [K in keyof S]: K extends 'evaluate' ? unknown : S[K];
};

export type SelectedProgram<S> = Program<
    SuiteProgram<S> extends (input: infer I) => unknown ? I : never,
    Effect.Success<ProgramEffect<S>>,
    Effect.Error<ProgramEffect<S>>,
    Effect.Services<ProgramEffect<S>>
>;

export class TestVariantRequired extends Schema.TaggedError<
    TestVariantRequired,
    {readonly brand: unique symbol}
>()('TestVariantRequired', {testSuiteName: Schema.String}) {}

export class TestVariantNotFound extends Schema.TaggedError<
    TestVariantNotFound,
    {readonly brand: unique symbol}
>()('TestVariantNotFound', {
    testSuiteName: Schema.String,
    variant: Schema.String,
}) {}

/**
 * Defines either one `program` or named `variants` that share cases, schemas,
 * and evaluation. A single program has the permanent variant ID `default`.
 * Named variants need an explicit selection, even when there is only one.
 * Variant IDs must be non-empty, contain no commas, and not start with `run:`.
 * Editing a program keeps its history; changing its ID starts another history.
 * An empty `variants` map keeps saved runs readable after all programs are removed.
 *
 * Runs the selected program once per distinct input/expected-value hash, then
 * evaluates its output. Later duplicates are warned about and skipped; the first
 * case's tags are kept. `O` and `T` describe the whole output and expected value;
 * `A` and `B` describe the evaluated values.
 * Without `evaluate`, reuse the same schema for evaluation.result and
 * evaluation.expected. Schema equality produces one result with key `result`.
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
} & (
    | ({
          schemas: TestSuiteSchemas<I, T, A, B>;
          testCases: TestCases<I, T, E, R>;
          evaluate: Evaluate<O, T, A, B>;
      } & TestSuitePrograms<I, O, E, R>)
    | ({
          schemas: TestSuiteSchemas<I, T & NoInfer<B>, A, B>;
          testCases: TestCases<I, T & NoInfer<B>, E, R>;
          evaluate?: undefined;
      } & TestSuitePrograms<I, O & NoInfer<A>, E, R>)
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

export type TestRunResults<I = unknown, O = unknown, T = unknown> = Pick<
    TestRun,
    'id' | 'name' | 'variant' | 'state'
> & {
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

export type TestResultComparison<I, A, B> =
    | {
          _tag: 'Matched';
          from: TestResult<I, A, B>;
          to: TestResult<I, A, B>;
          changed: boolean;
      }
    | {_tag: 'OnlyFrom'; from: TestResult<I, A, B>}
    | {_tag: 'OnlyTo'; to: TestResult<I, A, B>};

/** Selects a program without running it or requiring its services. */
export const selectVariant = internal.selectVariant;

/**
 * Runs only the selected program. Its error and service types include every
 * configured program and the case stream, even when the variant ID is a literal.
 */
export const all = internal.all;
/**
 * Compares complete saved runs without evaluating again. The shared codecs must
 * decode both runs and require no Effect services. Callers decide whether comparing
 * different suites or program versions is meaningful.
 *
 * Results match by case hash and evaluation key. A match changes when its label
 * or evaluated values change. Rows follow `to` order, followed by rows found only
 * in `from`, in `from` order. Empty complete runs are valid comparison endpoints.
 * Resolve missing baselines before calling; both endpoints must be saved runs.
 * Incompatible codecs fail with `TestValueError`, which names the saved suite.
 */
export const compareRuns = internal.compareRuns;
/**
 * Summarizes all matching results in a complete saved run. Each case contributes
 * its timing once. Empty complete runs have zero counts and no timing values.
 * The shared codecs must still read that run. The caller decides whether the
 * stored values still have the same meaning. Resolve a missing baseline before
 * calling; it differs from an empty run.
 */
export const summarizeRun = internal.summarizeRun;
export const diff = internal.diff;
/** Builds the lookup key for one evaluation within its original test case. */
export const resultKey = internal.resultKey;
export const runCollectRecord = internal.runCollectRecord;
/** Keeps matching results and recalculates counts and case timing statistics. */
export const filterResults = internal.filterResults;
