import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

import * as P from '../prelude.js';
import type {Classify} from '../Classify.js';
import {
    LabelSchema,
    Stats,
    defaultIsEqual,
    defaultIsNil,
    makeClassify,
    median,
    precision,
    recall,
} from './Classify.js';
import type {
    Program,
    TestCase,
    TestSuite,
    TestResult,
    TestRunResults,
    Diff,
} from '../Test.js';
import type {TestRun} from '../Test.repository.js';

export const makeSha256 = <I>(input: I): string => {
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

export const TestResultSchema: P.Schema.Schema<TestResult> = P.Schema.Struct({
    id: P.Schema.String,
    hashTestCase: P.Schema.String,
    ordering: P.Schema.Int,
    input: P.Schema.Unknown,
    result: P.Schema.Unknown,
    expected: P.Schema.Unknown,
    label: LabelSchema,
    tags: P.Schema.Array(P.Schema.String),
    timeMillis: P.Schema.Number,
});

const TestRunResults = {
    emptyFromTestRun: <I, O, T>(args: TestRun): TestRunResults<I, O, T> => ({
        ...args,
        testResultsByTestCaseHash: {},
        testCaseHashes: [],
        stats: Stats.empty(),
    }),
};

export const test = <I, O, T>({
    testCase: {input, expected, tags, ordering},
    program,
    classify,
}: {
    testCase: TestCase<I, T> & {ordering: number};
    program: Program<I, O>;
    classify: Classify<O, T>;
}): P.Effect.Effect<TestResult<I, O, T>> => {
    const t0 = performance.now();
    return program(input).pipe(
        P.Effect.map(result => {
            const t1 = performance.now();
            return TestResult.make({
                ordering,
                input,
                result,
                expected,
                tags: tags ?? [],
                label: classify(result, expected),
                timeMillis: t1 - t0,
            });
        }),
    );
};

export const all = <I, O, T>(
    {
        testCases,
        program,
        classify = makeClassify(defaultIsEqual, defaultIsNil, defaultIsNil),
    }: TestSuite<I, O, T>,
    {concurrency}: {concurrency?: number | undefined} = {concurrency: 1},
) =>
    P.pipe(
        // Keeping the index as the inherit ordering.
        P.Array.map(testCases, ({..._}, ordering) => ({..._, ordering})),
        P.Stream.fromIterable,
        P.Stream.mapEffect(testCase => test({testCase, program, classify}), {
            concurrency,
            unordered: false,
        }),
        P.Stream.tap(testResult => {
            const i = testResult.ordering;
            const total = testCases.length;
            const n = Math.floor(i % Math.max(total * 0.05, 10));
            if (i === 0 || n === 0 || i === total) {
                const s = `PROGRESS: ${i}/${total}\r`;
                if (process.env.NODE_ENV === 'development') {
                    process.stdout.write(s);
                } else {
                    return P.Console.log(s);
                }
            }
            return P.Effect.void;
        }),
    );

export const runCollectRecord =
    (testRun: TestRun) =>
    <I, O, T, E, R>(
        testResults$: P.Stream.Stream<TestResult<I, O, T>, E, R>,
    ): P.Effect.Effect<TestRunResults<I, O, T>, E, R> =>
        testResults$.pipe(
            P.Stream.runFold(
                TestRunResults.emptyFromTestRun<I, O, T>(testRun),
                (run, result) => {
                    run.testResultsByTestCaseHash[result.hashTestCase] = result;
                    run.testCaseHashes.push(result.hashTestCase);
                    run.stats[result.label]++;
                    return run;
                },
            ),
            P.Effect.map(run => {
                run.stats.precision = precision(run.stats);
                run.stats.recall = recall(run.stats);
                const times = run.testCaseHashes.map(
                    hash => run.testResultsByTestCaseHash[hash].timeMillis,
                );

                run.stats.timeMean = P.Option.some(
                    times.reduce((mean, n) => mean + n, 0) / times.length,
                );

                run.stats.timeMax = P.Option.some(
                    times.reduce((max, n) => Math.max(max, n), 0),
                );
                run.stats.timeMin = P.Option.some(
                    times.reduce((min, n) => Math.min(min, n), Infinity),
                );

                run.stats.timeMedian = median(times);

                run.stats.total = run.testCaseHashes.length;
                return run;
            }),
        );

export const diff = ({
    testRun: {stats},
    previousTestRun,
}: {
    testRun: TestRunResults;
    previousTestRun: P.Option.Option<TestRunResults>;
}): Diff =>
    previousTestRun.pipe(
        P.Option.match({
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
