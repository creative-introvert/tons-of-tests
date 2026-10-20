import * as t from '@effect/vitest';
import {Array as A, Effect, Exit, Option, Result, Stream} from 'effect';

import {Stats, defaultIsEqual, makeClassify} from '../Classify.js';
import type {Evaluate, EvaluationResult, TestResult} from '../Test.js';
import {TestRun} from '../Test.repository.js';
import {
    all,
    diff,
    filterResults,
    makeSha256,
    resultKey,
    runCollectRecord,
} from './Test.js';

const run = new TestRun({id: 1, name: 'suite', hash: null});

type AnyResult = TestResult<number, number | null, number | null>;

const mkResult = <R = number, E = number>(args: {
    input: number;
    expected: E;
    result: R;
    label: TestResult['label'];
    timeMillis: number;
    ordering?: number;
    key?: string;
    resultOrdering?: number;
}): TestResult<number, R, E> => ({
    id: makeSha256(args),
    hashTestCase: makeSha256({input: args.input, expected: args.expected}),
    key: args.key ?? 'result',
    ordering: args.ordering ?? 0,
    resultOrdering: args.resultOrdering ?? 0,
    input: args.input,
    result: args.result,
    expected: args.expected,
    label: args.label,
    tags: [],
    timeMillis: args.timeMillis,
});

const mkFN = (args: {
    input: number;
    expected: number;
    timeMillis: number;
    ordering?: number;
}): AnyResult => mkResult<null, number>({...args, result: null, label: 'FN'});

const mkTN = (args: {
    input: number;
    timeMillis: number;
    ordering?: number;
}): AnyResult =>
    mkResult<null, null>({...args, expected: null, result: null, label: 'TN'});

const collect = (results: readonly AnyResult[]) =>
    Stream.fromIterable(results).pipe(runCollectRecord(run));

t.describe('all', () => {
    const cases = [
        {input: 1, expected: 2},
        {input: 2, expected: 4},
        {input: 3, expected: 6},
    ] as const;

    t.it.effect.each(['array', 'stream'] as const)(
        'skips repeated %s cases before inference and resets the filter for each execution',
        source =>
            Effect.gen(function* () {
                const cases = [
                    {input: 1, expected: 2, tags: ['first']},
                    {input: 1, expected: 2, tags: ['duplicate']},
                    {input: 1, expected: 3, tags: ['different expectation']},
                    {input: 2, expected: 4, tags: ['second']},
                    {input: 2, expected: 4, tags: ['duplicate']},
                ];
                let calls = 0;
                const results = all(
                    {
                        name: 'duplicates',
                        testCases:
                            source === 'array'
                                ? cases
                                : Stream.fromIterable(cases),
                        program: (input: number) =>
                            Effect.sync(() => {
                                calls++;
                                return input * 2;
                            }),
                    },
                    {concurrency: 2},
                );
                const first = yield* results.pipe(Stream.runCollect);
                const second = yield* results.pipe(Stream.runCollect);
                t.expect({
                    calls,
                    runs: [first, second].map(rows =>
                        rows.map(({input, expected, ordering, tags}) => ({
                            input,
                            expected,
                            ordering,
                            tags,
                        })),
                    ),
                }).toEqual({
                    calls: 6,
                    runs: Array.from({length: 2}, () => [
                        {input: 1, expected: 2, ordering: 0, tags: ['first']},
                        {
                            input: 1,
                            expected: 3,
                            ordering: 2,
                            tags: ['different expectation'],
                        },
                        {input: 2, expected: 4, ordering: 3, tags: ['second']},
                    ]),
                });
            }),
    );

    t.it.effect.each([
        {
            description: 'array test cases keep source ordering',
            testCases: cases,
            expected: [
                {input: 1, ordering: 0},
                {input: 2, ordering: 1},
                {input: 3, ordering: 2},
            ],
        },
        {
            description: 'stream test cases keep source ordering',
            testCases: Stream.fromIterable(cases),
            expected: [
                {input: 1, ordering: 0},
                {input: 2, ordering: 1},
                {input: 3, ordering: 2},
            ],
        },
    ])('$description', ({testCases, expected}) =>
        Effect.gen(function* () {
            const results = yield* all({
                name: 'all-source-shapes',
                testCases,
                program: (input: number) => Effect.succeed(input * 2),
            }).pipe(Stream.runCollect);

            t.expectTypeOf(results[0].result).toEqualTypeOf<number>();
            t.expect(
                Array.from(results, ({input, ordering}) => ({input, ordering})),
            ).toStrictEqual(expected);
        }),
    );

    t.it.effect(
        'infers evaluation values separately from the program output',
        () =>
            Effect.gen(function* () {
                const results = yield* all({
                    name: 'inferred-evaluation',
                    testCases: [{input: 1, expected: {amount: 2}}],
                    program: (input: number) =>
                        Effect.succeed({amount: String(input)}),
                    evaluate: (output, expected) => [
                        {
                            key: 'amount',
                            result: output.amount,
                            expected: expected.amount,
                            label: 'FP',
                        },
                    ],
                }).pipe(Stream.runCollect);

                t.expectTypeOf(results).toEqualTypeOf<
                    Array<TestResult<number, string, number>>
                >();
                t.expect(results[0]).toMatchObject({
                    key: 'amount',
                    result: '1',
                    expected: 2,
                    label: 'FP',
                });
            }),
    );

    t.it.effect(
        'runs one inference per case and keeps separately keyed results',
        () =>
            Effect.gen(function* () {
                const fields = [
                    'budget',
                    'authority',
                    'need',
                    'timeline',
                ] as const;
                type Bant = Record<(typeof fields)[number], number>;
                const expected: Bant = {
                    budget: 1,
                    authority: 1,
                    need: 1,
                    timeline: 1,
                };
                const classify = makeClassify({isEqual: defaultIsEqual});
                const evaluate: Evaluate<Bant, Bant, number, number> = (
                    output,
                    expected,
                ) =>
                    A.map(fields, key => ({
                        key,
                        result: output[key],
                        expected: expected[key],
                        label: classify(output[key], expected[key]),
                    }));
                let calls = 0;
                const results = yield* all(
                    {
                        name: 'bant',
                        testCases: [
                            {input: 'call-1', expected},
                            {input: 'call-2', expected},
                        ],
                        program: () =>
                            Effect.sync(() => {
                                calls++;
                                return expected;
                            }),
                        evaluate,
                    },
                    {concurrency: 2},
                ).pipe(Stream.runCollect);

                t.expect(calls).toBe(2);
                t.expect(
                    results.map(
                        ({
                            key,
                            ordering,
                            resultOrdering,
                            hashTestCase,
                            label,
                            result,
                            expected: value,
                        }) => ({
                            key,
                            ordering,
                            resultOrdering,
                            hashTestCase,
                            label,
                            result,
                            expected: value,
                        }),
                    ),
                ).toEqual(
                    ['call-1', 'call-2'].flatMap((input, ordering) =>
                        fields.map((key, resultOrdering) => ({
                            key,
                            ordering,
                            resultOrdering,
                            hashTestCase: makeSha256({input, expected}),
                            label: 'TP',
                            result: 1,
                            expected: 1,
                        })),
                    ),
                );
                t.expect(new Set(results.map(r => r.id)).size).toBe(8);
                const collected = yield* Stream.fromIterable(results).pipe(
                    runCollectRecord(run),
                );
                t.expect(Object.keys(collected.testResultsByKey)).toHaveLength(
                    8,
                );
                t.expect(collected.stats).toMatchObject({
                    total: 8,
                    testCases: 2,
                    TP: 8,
                });
            }),
    );

    t.it.effect(
        'reordering evaluation results preserves their identities',
        () =>
            Effect.gen(function* () {
                const evaluate: Evaluate<number, number> = (
                    result,
                    expected,
                ) => [
                    {key: 'first', result, expected, label: 'TP'},
                    {key: 'second', result, expected, label: 'TP'},
                ];
                const suite = {
                    name: 'order',
                    testCases: [{input: 1, expected: 1}],
                    program: Effect.succeed,
                    evaluate,
                };
                const first = yield* all(suite).pipe(Stream.runCollect);
                const second = yield* all({
                    ...suite,
                    evaluate: (result: number, expected: number) =>
                        A.reverse(evaluate(result, expected)),
                }).pipe(Stream.runCollect);
                t.expect(second.map(({key, id}) => ({key, id}))).toEqual(
                    first.map(({key, id}) => ({key, id})).reverse(),
                );
                t.expect(second.map(r => r.resultOrdering)).toEqual([0, 1]);
            }),
    );

    t.it.effect.each([
        {name: 'empty results', results: []},
        {
            name: 'empty key',
            results: [{key: '', result: 1, expected: 1, label: 'TP' as const}],
        },
        {
            name: 'duplicate keys',
            results: [
                {key: 'budget', result: 1, expected: 1, label: 'TP' as const},
                {key: 'budget', result: 2, expected: 1, label: 'FP' as const},
            ],
        },
    ])('rejects $name before emitting a partial case', ({results}) =>
        Effect.gen(function* () {
            const emitted: TestResult[] = [];
            const suite = {
                name: 'invalid-evaluation',
                testCases: [{input: 1, expected: 1}],
                program: Effect.succeed,
                evaluate: (): readonly EvaluationResult<number, number>[] =>
                    results,
            };
            // Exercise JavaScript callers that cannot enforce the non-empty return type.
            // @ts-expect-error evaluate must return a non-empty array.
            const output = all(suite);
            const exit = yield* output.pipe(
                Stream.tap(result =>
                    Effect.sync(() => {
                        emitted.push(result);
                    }),
                ),
                Stream.runDrain,
                Effect.exit,
            );
            t.expect(Exit.isFailure(exit)).toBe(true);
            t.expect(emitted).toEqual([]);
        }),
    );

    t.it.effect('preserves inference failures without evaluating', () =>
        Effect.gen(function* () {
            const failure = {_tag: 'InferenceError'} as const;
            let evaluations = 0;
            const result = yield* all({
                name: 'failed-inference',
                testCases: [{input: 1, expected: 1}],
                program: () => Effect.fail(failure),
                evaluate: (output: number, expected: number) => {
                    evaluations++;
                    return [
                        {key: 'result', result: output, expected, label: 'TP'},
                    ];
                },
            }).pipe(Stream.runCollect, Effect.result);
            t.expect(result).toEqual(Result.fail(failure));
            t.expect(evaluations).toBe(0);
        }),
    );
});

t.describe('runCollectRecord', () => {
    t.it.effect.each([
        {description: 'empty stream', input: [], expected: 0},
        {
            description: 'non-empty stream',
            input: [
                mkResult({
                    input: 1,
                    expected: 1,
                    result: 1,
                    label: 'TP',
                    timeMillis: 2,
                }),
            ],
            expected: 1,
        },
    ])('keeps repeated runs separate: $description', ({input, expected}) =>
        Effect.gen(function* () {
            const collect = Stream.fromIterable(input).pipe(
                runCollectRecord(run),
            );
            const first = yield* collect;
            const second = yield* collect;

            t.expect(first.stats.total).toBe(expected);
            t.expect(second.stats.total).toBe(expected);
            t.expect(second.testCaseHashes).toEqual(first.testCaseHashes);
            t.expect(second.testCaseHashes).not.toBe(first.testCaseHashes);
        }),
    );

    t.it.effect('empty stream -> empty stats with none-options', () =>
        Effect.gen(function* () {
            const out = yield* collect([]);
            t.expect(out).toEqual({
                id: run.id,
                name: run.name,
                hash: run.hash,
                stats: Stats.empty(),
                testCaseHashes: [],
                testResultsByKey: {},
                testResultKeys: [],
            });
        }),
    );

    t.it.effect(
        'mixed labels -> correct counts, precision, recall, time stats',
        () =>
            Effect.gen(function* () {
                const results: AnyResult[] = [
                    mkResult({
                        input: 1,
                        expected: 1,
                        result: 1,
                        label: 'TP',
                        timeMillis: 10,
                    }),
                    mkResult({
                        input: 2,
                        expected: 2,
                        result: 2,
                        label: 'TP',
                        timeMillis: 20,
                    }),
                    mkResult({
                        input: 3,
                        expected: 3,
                        result: 4,
                        label: 'FP',
                        timeMillis: 30,
                    }),
                    mkFN({input: 4, expected: 4, timeMillis: 40}),
                    mkTN({input: 5, timeMillis: 50}),
                ];
                const out = yield* collect(results);
                t.expect(out.stats.TP).toBe(2);
                t.expect(out.stats.FP).toBe(1);
                t.expect(out.stats.FN).toBe(1);
                t.expect(out.stats.TN).toBe(1);
                t.expect(out.stats.total).toBe(5);
                t.expect(out.stats.precision).toBeCloseTo(2 / 3);
                t.expect(out.stats.recall).toBeCloseTo(2 / 3);
                t.expect(Option.getOrThrow(out.stats.timeMin)).toBe(10);
                t.expect(Option.getOrThrow(out.stats.timeMax)).toBe(50);
                t.expect(Option.getOrThrow(out.stats.timeMean)).toBeCloseTo(30);
                t.expect(Option.getOrThrow(out.stats.timeMedian)).toBe(30);
            }),
    );

    t.it.effect(
        'repeated result identities keep the last value and preserve row count',
        () =>
            Effect.gen(function* () {
                const a = mkResult({
                    input: 1,
                    expected: 1,
                    result: 1,
                    label: 'TP',
                    timeMillis: 1,
                    ordering: 0,
                });
                const b = mkResult({
                    input: 1,
                    expected: 1,
                    result: 2,
                    label: 'FP',
                    timeMillis: 2,
                    ordering: 1,
                });
                const out = yield* collect([a, b]);
                t.expect(Object.keys(out.testResultsByKey)).toHaveLength(1);
                t.expect(out.testCaseHashes).toHaveLength(1);
                t.expect(out.testResultKeys).toHaveLength(2);
                t.expect(out.testResultsByKey[resultKey(a)].label).toBe('FP');
            }),
    );

    t.it.effect(
        'counts inference time once per case and recomputes filtered statistics',
        () =>
            Effect.gen(function* () {
                const first = ['budget', 'authority', 'need', 'timeline'].map(
                    (key, resultOrdering) =>
                        mkResult({
                            input: 1,
                            expected: 1,
                            result: 1,
                            label: 'TP',
                            timeMillis: 100,
                            key,
                            resultOrdering,
                        }),
                );
                const second = mkResult({
                    input: 2,
                    expected: 2,
                    result: 3,
                    label: 'FP',
                    timeMillis: 900,
                    key: 'budget',
                    ordering: 1,
                });
                const allResults = yield* collect([...first, second]);
                const budget = filterResults(
                    allResults,
                    result => result.key === 'budget',
                );
                const failures = filterResults(
                    budget,
                    result => result.label === 'FP',
                );
                const empty = filterResults(allResults, () => false);

                t.expect(
                    [allResults, budget, failures, empty].map(({stats}) => ({
                        total: stats.total,
                        cases: stats.testCases,
                        TP: stats.TP,
                        FP: stats.FP,
                        mean: Option.getOrNull(stats.timeMean),
                        median: Option.getOrNull(stats.timeMedian),
                    })),
                ).toEqual([
                    {total: 5, cases: 2, TP: 4, FP: 1, mean: 500, median: 500},
                    {total: 2, cases: 2, TP: 1, FP: 1, mean: 500, median: 500},
                    {total: 1, cases: 1, TP: 0, FP: 1, mean: 900, median: 900},
                    {
                        total: 0,
                        cases: 0,
                        TP: 0,
                        FP: 0,
                        mean: null,
                        median: null,
                    },
                ]);
            }),
    );
});

t.describe('Test.diff', () => {
    const mkStats = (overrides: Partial<Stats>) =>
        Object.assign(Stats.empty(), overrides);

    const mkRunResults = (stats: Stats) => ({
        id: run.id,
        name: run.name,
        hash: run.hash,
        stats,
        testCaseHashes: [],
        testResultKeys: [],
        testResultsByKey: {},
    });

    t.test.each([
        {
            description: 'no previous run -> returns raw stats',
            previous: Option.none<ReturnType<typeof mkRunResults>>(),
            current: mkStats({TP: 3, FP: 1, precision: 0.75, recall: 0.5}),
            expected: {
                TP: 3,
                FP: 1,
                TN: 0,
                FN: 0,
                precision: 0.75,
                recall: 0.5,
            },
        },
        {
            description: 'with previous -> field-by-field delta',
            previous: Option.some(
                mkRunResults(
                    mkStats({
                        TP: 1,
                        FP: 1,
                        TN: 1,
                        FN: 1,
                        precision: 0.5,
                        recall: 0.5,
                    }),
                ),
            ),
            current: mkStats({
                TP: 3,
                FP: 0,
                TN: 2,
                FN: 1,
                precision: 1,
                recall: 0.75,
            }),
            expected: {
                TP: 2,
                FP: -1,
                TN: 1,
                FN: 0,
                precision: 0.5,
                recall: 0.25,
            },
        },
    ])('$description', ({previous, current, expected}) => {
        const testRun = mkRunResults(current);
        const out = diff({testRun, previousTestRun: previous});
        t.expect(out).toMatchObject(expected);
    });
});
