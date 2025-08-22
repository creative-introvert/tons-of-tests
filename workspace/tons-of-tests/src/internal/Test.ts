import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

import {
    Array as A,
    Console,
    Effect,
    Option,
    Schema,
    Stream,
    pipe,
} from 'effect';

import type {Classify} from '../Classify.js';
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
    LabelSchema,
    Stats,
    defaultIsEqual,
    defaultIsNil,
    makeClassify,
    median,
    precision,
    recall,
} from './Classify.js';

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

export const TestResultSchema: Schema.Schema<TestResult> = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    ordering: Schema.Int,
    input: Schema.Unknown,
    result: Schema.Unknown,
    expected: Schema.Unknown,
    label: LabelSchema,
    tags: Schema.Array(Schema.String),
    timeMillis: Schema.Number,
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
}): Effect.Effect<TestResult<I, O, T>> => {
    const t0 = performance.now();
    return program(input).pipe(
        Effect.map(result => {
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
        classify = makeClassify({isEqual: defaultIsEqual}),
    }: TestSuite<I, O, T>,
    {concurrency}: {concurrency?: number | undefined} = {concurrency: 1},
) =>
    pipe(
        // Keeping the index as the inherent ordering.
        A.map(testCases, ({..._}, ordering) => ({..._, ordering})),
        Stream.fromIterable,
        Stream.mapEffect(testCase => test({testCase, program, classify}), {
            concurrency,
            unordered: false,
        }),
        Stream.tap(testResult => {
            const i = testResult.ordering + 1;
            const total = testCases.length;
            const n = Math.floor(i % Math.max(total * 0.05, 10));
            if (i === 1 || n === 0 || i === total) {
                const s = `PROGRESS: ${i}/${total}\r`;
                if (process.env.NODE_ENV === 'development') {
                    process.stdout.write(s);
                } else {
                    return Console.log(s);
                }
            }
            return Effect.void;
        }),
    );

export const runCollectRecord =
    (testRun: TestRun) =>
    <I, O, T, E, R>(
        testResults$: Stream.Stream<TestResult<I, O, T>, E, R>,
    ): Effect.Effect<TestRunResults<I, O, T>, E, R> =>
        testResults$.pipe(
            Stream.runFold(
                TestRunResults.emptyFromTestRun<I, O, T>(testRun),
                (run, result) => {
                    run.testResultsByTestCaseHash[result.hashTestCase] = result;
                    run.testCaseHashes.push(result.hashTestCase);
                    run.stats[result.label]++;
                    return run;
                },
            ),
            Effect.map(run => {
                run.stats.precision = precision(run.stats);
                run.stats.recall = recall(run.stats);
                const times = run.testCaseHashes.map(
                    hash => run.testResultsByTestCaseHash[hash].timeMillis,
                );

                run.stats.timeMean = Option.some(
                    times.reduce((mean, n) => mean + n, 0) / times.length,
                );

                run.stats.timeMax = Option.some(
                    times.reduce((max, n) => Math.max(max, n), 0),
                );
                run.stats.timeMin = Option.some(
                    times.reduce(
                        (min, n) => Math.min(min, n),
                        Number.POSITIVE_INFINITY,
                    ),
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
