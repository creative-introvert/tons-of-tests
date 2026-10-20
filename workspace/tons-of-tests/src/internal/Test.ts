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
import type {TestValueError} from '../TestValueError.js';
import {
    makeResultCodec,
    makeValueCodec,
    stringifyJson,
} from './Test.serialization.js';
import {makeClassify, median, precision, recall} from './Classify.js';

/** Hash already encoded JSON. Object key order does not affect identity. */
export const makeSha256 = (input: Schema.Json): string =>
    createHash('sha256').update(stringifyJson(input)).digest('hex');

export const resultKey = ({
    hashTestCase,
    key,
}: Pick<TestResult, 'hashTestCase' | 'key'>): string =>
    JSON.stringify([hashTestCase, key]);

export const test = Effect.fnUntraced(function* <I, O, T, E, R, A, B>({
    testCase: {input, expected, tags, ordering},
    hashTestCase,
    program,
    evaluate,
    encodeResult,
}: {
    testCase: TestCase<I, T> & {ordering: number};
    hashTestCase: string;
    program: Program<I, O, E, R>;
    evaluate: Evaluate<O, T, A, B>;
    encodeResult: ReturnType<typeof makeResultCodec<I, A, B>>['encode'];
}) {
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
    return yield* Effect.forEach(evaluations, (evaluation, resultOrdering) =>
        Effect.gen(function* () {
            const args = {
                ...evaluation,
                hashTestCase,
                ordering,
                resultOrdering,
                input,
                tags: tags ?? [],
                timeMillis: Number(t1 - t0) / 1_000_000,
            };
            const encoded = yield* encodeResult(args);
            // Ordering, tags, and timing do not change result identity.
            return {
                ...args,
                id: makeSha256({
                    hashTestCase,
                    key: evaluation.key,
                    label: evaluation.label,
                    input: encoded.input,
                    result: encoded.result,
                    expected: encoded.expected,
                }),
            };
        }),
    );
});

export const all = <I, O, T, E, R, A = O, B = T>(
    suite: TestSuite<I, O, T, E, R, A, B>,
    {concurrency}: {concurrency?: number | undefined} = {concurrency: 1},
): Stream.Stream<TestResult<I, A, B>, E | TestValueError, R> => {
    if (suite.evaluate === undefined) {
        if (
            !Object.is(
                suite.schemas.evaluation.result,
                suite.schemas.evaluation.expected,
            )
        ) {
            return Stream.die(
                new Error(
                    `${suite.name}: without evaluate, evaluation.result and evaluation.expected must reuse the same schema`,
                ),
            );
        }
        const classify = makeClassify<A | B, A | B>({
            isEqual: Schema.toEquivalence(
                Schema.Union([
                    suite.schemas.evaluation.result,
                    suite.schemas.evaluation.expected,
                ]),
            ),
        });
        return all<I, A, B, E, R, A, B>(
            {
                ...suite,
                evaluate: (result, expected) => [
                    {
                        key: 'result',
                        result,
                        expected,
                        label: classify(result, expected),
                    },
                ],
            },
            {concurrency},
        );
    }
    const {testCases, program, evaluate, schemas} = suite;
    const inputCodec = makeValueCodec(schemas.testCase.input);
    const expectedCodec = makeValueCodec(schemas.testCase.expected);
    const {encode: encodeResult} = makeResultCodec(schemas, suite.name);
    const total = Stream.isStream(testCases) ? undefined : testCases.length;
    const testCases$ = Stream.isStream(testCases)
        ? testCases
        : Stream.fromIterable(testCases);

    return Stream.suspend(() => {
        const seen = new Set<string>();
        return pipe(
            testCases$,
            Stream.zipWithIndex,
            Stream.mapEffect(
                Effect.fnUntraced(function* ([testCase, ordering]) {
                    const context = {
                        suite: suite.name,
                        caseNumber: ordering + 1,
                    };
                    const input = yield* inputCodec.encode(testCase.input, {
                        ...context,
                        field: 'testCase.input',
                    });
                    const expected = yield* expectedCodec.encode(
                        testCase.expected,
                        {
                            ...context,
                            field: 'testCase.expected',
                        },
                    );
                    return {
                        testCase: {...testCase, ordering},
                        hashTestCase: makeSha256({input, expected}),
                    };
                }),
            ),
            Stream.filterEffect(({testCase, hashTestCase}) => {
                if (seen.has(hashTestCase)) {
                    return Effect.logWarning('Skipping duplicate test case.', {
                        suite: suite.name,
                        hashTestCase,
                        caseNumber: testCase.ordering + 1,
                    }).pipe(Effect.as(false));
                }
                seen.add(hashTestCase);
                return Effect.succeed(true);
            }),
            Stream.mapEffect(
                ({testCase, hashTestCase}) =>
                    test({
                        testCase,
                        hashTestCase,
                        program,
                        evaluate,
                        encodeResult,
                    }),
                {
                    concurrency,
                    unordered: false,
                },
            ),
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
    });
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
    testRun: Pick<TestRun, 'id' | 'name' | 'hash'>,
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
    testRun: Pick<TestRunResults, 'stats'>;
    previousTestRun: Option.Option<Pick<TestRunResults, 'stats'>>;
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
