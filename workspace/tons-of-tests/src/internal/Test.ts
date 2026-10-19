import {createHash} from 'node:crypto';
import {Clock, Effect, Option, pipe, Schema, Sink, Stream} from 'effect';

import type {Classify} from '../Classify.js';
import {Stats} from '../Classify.js';
import type {
    Diff,
    Program,
    TestCase,
    TestResult,
    TestRunResults,
    TestSuite,
} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {
    defaultIsEqual,
    defaultIsNil,
    LabelSchema,
    makeClassify,
    median,
    precision,
    recall,
} from './Classify.js';

export const makeSha256 = <I>(input: I): string => {
    // This public synchronous helper keeps result IDs stable across releases.
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
};

const TestResult = {
    make: <I, O, T>(args: Omit<TestResult<I, O, T>, 'id' | 'hashTestCase'>) => {
        const {label, input, result, expected} = args;

        // Without `ordering`, in case the user decides to re-order test cases,
        // which shouldn't change the identity of the test result.
        // Without `tags`, as those are just for filtering.
        const id = makeSha256({label, input, result, expected});
        const hashTestCase = makeSha256({input, expected});

        return {
            ...args,
            id,
            hashTestCase,
        };
    },
};

export const TestResultSchema: Schema.Codec<TestResult> = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    ordering: Schema.Int,
    input: Schema.Unknown,
    result: Schema.Unknown,
    expected: Schema.Unknown,
    label: LabelSchema,
    tags: Schema.Array(Schema.String),
    timeMillis: Schema.Finite,
});

export const test = Effect.fnUntraced(function* <I, O, T, E, R>({
    testCase: {input, expected, tags, ordering},
    program,
    classify,
}: {
    testCase: TestCase<I, T> & {ordering: number};
    program: Program<I, O, E, R>;
    classify: Classify<O, T>;
}) {
    const t0 = yield* Clock.currentTimeNanos;
    const result = yield* program(input);
    const t1 = yield* Clock.currentTimeNanos;
    return TestResult.make({
        ordering,
        input,
        result,
        expected,
        tags: tags ?? [],
        label: classify(result, expected),
        timeMillis: Number(t1 - t0) / 1_000_000,
    });
});

export const all = <I, O, T, E, R>(
    {
        testCases,
        program,
        classify = makeClassify({isEqual: defaultIsEqual}),
    }: TestSuite<I, O, T, E, R>,
    {concurrency}: {concurrency?: number | undefined} = {concurrency: 1},
): Stream.Stream<TestResult<I, O, T>, E, R> => {
    const total = Stream.isStream(testCases) ? undefined : testCases.length;
    const testCases$ = Stream.isStream(testCases)
        ? testCases
        : Stream.fromIterable(testCases);

    return pipe(
        testCases$,
        Stream.zipWithIndex,
        Stream.map(([testCase, ordering]) => ({...testCase, ordering})),
        Stream.mapEffect(testCase => test({testCase, program, classify}), {
            concurrency,
            unordered: false,
        }),
        Stream.tap(testResult => {
            const i = testResult.ordering + 1;
            const stride =
                total === undefined
                    ? 10
                    : Math.max(Math.floor(total * 0.05), 10);
            const isMilestone =
                i === 1 ||
                i % stride === 0 ||
                (total !== undefined && i === total);
            if (!isMilestone) return Effect.void;

            return Effect.logDebug(
                total === undefined
                    ? `progress ${i}`
                    : `progress ${i}/${total}`,
            );
        }),
    );
};

type FoldAcc<I, O, T> = {
    testResultsByTestCaseHash: Record<string, TestResult<I, O, T>>;
    testCaseHashes: string[];
    times: number[];
    TP: number;
    TN: number;
    FP: number;
    FN: number;
    timeSum: number;
    timeMin: number;
    timeMax: number;
};

const emptyAcc = <I, O, T>(): FoldAcc<I, O, T> => ({
    testResultsByTestCaseHash: {},
    testCaseHashes: [],
    times: [],
    TP: 0,
    TN: 0,
    FP: 0,
    FN: 0,
    timeSum: 0,
    timeMin: Number.POSITIVE_INFINITY,
    timeMax: Number.NEGATIVE_INFINITY,
});

export const runCollectRecord =
    (testRun: TestRun) =>
    <I, O, T, E, R>(
        testResults$: Stream.Stream<TestResult<I, O, T>, E, R>,
    ): Effect.Effect<TestRunResults<I, O, T>, E, R> =>
        testResults$.pipe(
            Stream.run(
                // Each run owns its accumulator, so updates can happen in place.
                Sink.reduce(
                    emptyAcc<I, O, T>,
                    (acc, r: TestResult<I, O, T>) => {
                        acc.testResultsByTestCaseHash[r.hashTestCase] = r;
                        acc.testCaseHashes.push(r.hashTestCase);
                        acc.times.push(r.timeMillis);
                        acc.timeSum += r.timeMillis;
                        if (r.timeMillis < acc.timeMin)
                            acc.timeMin = r.timeMillis;
                        if (r.timeMillis > acc.timeMax)
                            acc.timeMax = r.timeMillis;
                        if (r.label === 'TP') acc.TP++;
                        else if (r.label === 'TN') acc.TN++;
                        else if (r.label === 'FP') acc.FP++;
                        else acc.FN++;
                        return acc;
                    },
                ),
            ),
            Effect.map(acc => {
                const total = acc.testCaseHashes.length;
                const hasTimes = acc.times.length > 0;
                const stats = new Stats({
                    TP: acc.TP,
                    TN: acc.TN,
                    FP: acc.FP,
                    FN: acc.FN,
                    total,
                    precision: precision({TP: acc.TP, FP: acc.FP}),
                    recall: recall({TP: acc.TP, FN: acc.FN}),
                    timeMean: hasTimes
                        ? Option.some(acc.timeSum / acc.times.length)
                        : Option.none(),
                    timeMin: hasTimes
                        ? Option.some(acc.timeMin)
                        : Option.none(),
                    timeMax: hasTimes
                        ? Option.some(acc.timeMax)
                        : Option.none(),
                    timeMedian: median(acc.times),
                });

                return {
                    id: testRun.id,
                    name: testRun.name,
                    hash: testRun.hash,
                    testResultsByTestCaseHash: acc.testResultsByTestCaseHash,
                    testCaseHashes: acc.testCaseHashes,
                    stats,
                };
            }),
        );

export const diff = ({
    testRun: {stats},
    previousTestRun,
}: {
    testRun: TestRunResults;
    previousTestRun: Option.Option<TestRunResults>;
}): Diff =>
    previousTestRun.pipe(
        Option.match({
            onNone: () => stats,
            onSome: ({stats: previousStats}) => ({
                TP: stats.TP - previousStats.TP,
                TN: stats.TN - previousStats.TN,
                FP: stats.FP - previousStats.FP,
                FN: stats.FN - previousStats.FN,
                precision: stats.precision - previousStats.precision,
                recall: stats.recall - previousStats.recall,
            }),
        }),
    );
