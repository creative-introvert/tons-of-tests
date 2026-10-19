import {createHash} from 'node:crypto';
import {Clock, Effect, Option, pipe, Schema, Sink, Stream} from 'effect';

import {Stats} from '../Classify.js';
import type {
    Diff,
    Evaluate,
    Program,
    TestCase,
    TestResult,
    TestRunResults,
    TestSuite,
} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {
    defaultIsEqual,
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
    make: <I, O, T>(args: Omit<TestResult<I, O, T>, 'id'>) => {
        const {hashTestCase, key, label, input, result, expected} = args;

        // Reordering cases or evaluations must not change a result's identity.
        // Tags and timing also stay out of the ID.
        const id = makeSha256({
            hashTestCase,
            key,
            label,
            input,
            result,
            expected,
        });

        return {
            ...args,
            id,
        };
    },
};

export const resultKey = ({
    hashTestCase,
    key,
}: Pick<TestResult, 'hashTestCase' | 'key'>): string =>
    JSON.stringify([hashTestCase, key]);

const defaultClassify = makeClassify({isEqual: defaultIsEqual});

const defaultEvaluate = <O, T>(
    result: O,
    expected: T,
): ReturnType<Evaluate<O, T>> => [
    {key: 'result', result, expected, label: defaultClassify(result, expected)},
];

export const TestResultSchema: Schema.Codec<TestResult> = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    key: Schema.String,
    ordering: Schema.Int,
    resultOrdering: Schema.Int,
    input: Schema.Unknown,
    result: Schema.Unknown,
    expected: Schema.Unknown,
    label: LabelSchema,
    tags: Schema.Array(Schema.String),
    timeMillis: Schema.Finite,
});

export const test = Effect.fnUntraced(function* <I, O, T, E, R, A, B>({
    testCase: {input, expected, tags, ordering},
    program,
    evaluate,
}: {
    testCase: TestCase<I, T> & {ordering: number};
    program: Program<I, O, E, R>;
    evaluate: Evaluate<O, T, A, B>;
}) {
    const hashTestCase = makeSha256({input, expected});
    const t0 = yield* Clock.currentTimeNanos;
    const result = yield* program(input);
    const t1 = yield* Clock.currentTimeNanos;
    const evaluations = evaluate(result, expected);
    if (evaluations.length === 0) {
        return yield* Effect.die(
            new Error('evaluate must return at least one result'),
        );
    }
    const keys = new Set<string>();
    for (const {key} of evaluations) {
        if (key.length === 0 || keys.has(key)) {
            return yield* Effect.die(
                new Error(
                    'evaluate must return non-empty keys that are unique within each test case',
                ),
            );
        }
        keys.add(key);
    }
    return evaluations.map((evaluation, resultOrdering) =>
        TestResult.make({
            ...evaluation,
            hashTestCase,
            ordering,
            resultOrdering,
            input,
            tags: tags ?? [],
            timeMillis: Number(t1 - t0) / 1_000_000,
        }),
    );
});

export const all = <I, O, T, E, R, A = O, B = T>(
    suite: TestSuite<I, O, T, E, R, A, B>,
    {concurrency}: {concurrency?: number | undefined} = {concurrency: 1},
): Stream.Stream<TestResult<I, A, B>, E, R> => {
    if (suite.evaluate === undefined) {
        return all<I, A, B, E, R, A, B>(
            {...suite, evaluate: defaultEvaluate},
            {concurrency},
        );
    }
    const {testCases, program, evaluate} = suite;
    const total = Stream.isStream(testCases) ? undefined : testCases.length;
    const testCases$ = Stream.isStream(testCases)
        ? testCases
        : Stream.fromIterable(testCases);

    return pipe(
        testCases$,
        Stream.zipWithIndex,
        Stream.map(([testCase, ordering]) => ({...testCase, ordering})),
        Stream.mapEffect(testCase => test({testCase, program, evaluate}), {
            concurrency,
            unordered: false,
        }),
        Stream.tap(testResults => {
            const i = testResults[0].ordering + 1;
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
        Stream.flattenIterable,
    );
};

type FoldAcc<I, O, T> = {
    testResultsByKey: Record<string, TestResult<I, O, T>>;
    testResultKeys: string[];
    timesByTestCaseHash: Map<string, number>;
    TP: number;
    TN: number;
    FP: number;
    FN: number;
};

const emptyAcc = <I, O, T>(): FoldAcc<I, O, T> => ({
    testResultsByKey: {},
    testResultKeys: [],
    timesByTestCaseHash: new Map(),
    TP: 0,
    TN: 0,
    FP: 0,
    FN: 0,
});

const appendResult = <I, O, T>(
    acc: FoldAcc<I, O, T>,
    r: TestResult<I, O, T>,
): FoldAcc<I, O, T> => {
    const key = resultKey(r);
    acc.testResultsByKey[key] = r;
    acc.testResultKeys.push(key);
    if (!acc.timesByTestCaseHash.has(r.hashTestCase)) {
        acc.timesByTestCaseHash.set(r.hashTestCase, r.timeMillis);
    }
    if (r.label === 'TP') acc.TP++;
    else if (r.label === 'TN') acc.TN++;
    else if (r.label === 'FP') acc.FP++;
    else acc.FN++;
    return acc;
};

const finish = <I, O, T>(
    testRun: TestRun,
    acc: FoldAcc<I, O, T>,
): TestRunResults<I, O, T> => {
    const times = [...acc.timesByTestCaseHash.values()];
    let timeSum = 0;
    let timeMin = Number.POSITIVE_INFINITY;
    let timeMax = Number.NEGATIVE_INFINITY;
    for (const time of times) {
        timeSum += time;
        if (time < timeMin) timeMin = time;
        if (time > timeMax) timeMax = time;
    }
    const stats = new Stats({
        TP: acc.TP,
        TN: acc.TN,
        FP: acc.FP,
        FN: acc.FN,
        total: acc.testResultKeys.length,
        testCases: acc.timesByTestCaseHash.size,
        precision: precision({TP: acc.TP, FP: acc.FP}),
        recall: recall({TP: acc.TP, FN: acc.FN}),
        timeMean:
            times.length > 0
                ? Option.some(timeSum / times.length)
                : Option.none(),
        timeMin: times.length > 0 ? Option.some(timeMin) : Option.none(),
        timeMax: times.length > 0 ? Option.some(timeMax) : Option.none(),
        timeMedian: median(times),
    });
    return {
        id: testRun.id,
        name: testRun.name,
        hash: testRun.hash,
        testResultsByKey: acc.testResultsByKey,
        testResultKeys: acc.testResultKeys,
        testCaseHashes: [...acc.timesByTestCaseHash.keys()],
        stats,
    };
};

export const runCollectRecord =
    (testRun: TestRun) =>
    <I, O, T, E, R>(
        testResults$: Stream.Stream<TestResult<I, O, T>, E, R>,
    ): Effect.Effect<TestRunResults<I, O, T>, E, R> =>
        testResults$.pipe(
            Stream.run(Sink.reduce(emptyAcc<I, O, T>, appendResult)),
            Effect.map(acc => finish(testRun, acc)),
        );

export const filterResults = <I, O, T>(
    testRun: TestRunResults<I, O, T>,
    predicate: (result: TestResult<I, O, T>) => boolean,
): TestRunResults<I, O, T> => {
    const acc = emptyAcc<I, O, T>();
    for (const key of testRun.testResultKeys) {
        const result = testRun.testResultsByKey[key];
        if (predicate(result)) appendResult(acc, result);
    }
    return finish(testRun, acc);
};

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
