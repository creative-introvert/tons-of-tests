import * as t from '@effect/vitest';
import {Array as A, Effect, Exit, Option, Result, Schema, Stream} from 'effect';

import {Stats, makeClassify} from '../Classify.js';
import type {Evaluate, EvaluationResult, TestResult} from '../Test.js';
import * as Test from '../Test.js';
import {
    TestRepository,
    TestRun,
    type TestResultSchemas,
} from '../Test.repository.js';
import {
    all,
    diff,
    filterResults,
    makeSha256,
    resultKey,
    runCollectRecord,
} from './Test.js';

const run = new TestRun({
    id: 1,
    name: 'suite',
    variant: 'default',
    state: 'Complete',
});
const numberSchemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};

type AnyResult = TestResult<number, number | null, number | null>;

const mkResult = <
    R extends Schema.Json = number,
    E extends Schema.Json = number,
>(args: {
    input: number;
    expected: E;
    result: R;
    label: TestResult['label'];
    timeMillis: number;
    ordering?: number;
    key?: string;
    resultOrdering?: number;
}): TestResult<number, R, E> => ({
    id: makeSha256({
        input: args.input,
        result: args.result,
        expected: args.expected,
        label: args.label,
        key: args.key ?? 'result',
    }),
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

const saveRun = <I, A, B>(
    selection: Pick<TestRun, 'name' | 'variant'>,
    results: ReadonlyArray<TestResult<I, A, B>>,
    schemas: TestResultSchemas<I, A, B>,
) =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const saved = yield* repository.withTestRun(selection, run =>
            repository.insertTestResults(results, run, schemas),
        );
        return saved.run;
    });

t.describe('variant selection', () => {
    t.it.effect.each([undefined, 'default'])(
        'selects the single program for %s',
        variant =>
            Effect.gen(function* () {
                const program = (input: number) => Effect.succeed(input);
                const suite = {
                    name: 'single-program',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program,
                };
                const selected = yield* Test.selectVariant(suite, variant);
                const results = yield* Test.all(suite, {variant}).pipe(
                    Stream.runCollect,
                );
                t.expect(selected).toEqual({name: 'default', program});
                t.expect(
                    results.map(({result, label}) => ({result, label})),
                ).toEqual([{result: 1, label: 'TP'}]);
            }),
    );

    t.it.effect.each([
        {variants: ['A'], variant: undefined, tag: 'TestVariantRequired'},
        {variants: ['A', 'B'], variant: 'C', tag: 'TestVariantNotFound'},
        {variants: [], variant: undefined, tag: 'TestVariantRequired'},
        {variants: [], variant: 'A', tag: 'TestVariantNotFound'},
    ])(
        'rejects selection $variant from $variants before consuming cases',
        ({variants, variant, tag}) =>
            Effect.gen(function* () {
                let cases = 0;
                let programs = 0;
                let evaluations = 0;
                const program = (input: number) =>
                    Effect.sync(() => {
                        programs++;
                        return input;
                    });
                const suite = {
                    name: 'selection-failure',
                    schemas: numberSchemas,
                    testCases: Stream.fromEffect(
                        Effect.sync(() => {
                            cases++;
                            return {input: 1, expected: 1};
                        }),
                    ),
                    variants: Object.fromEntries(
                        variants.map(name => [name, {program}]),
                    ),
                    evaluate: (result: number, expected: number) => {
                        evaluations++;
                        return [
                            {key: 'result', result, expected, label: 'TP'},
                        ] as const;
                    },
                };
                const selectionError = yield* Test.selectVariant(
                    suite,
                    variant,
                ).pipe(Effect.flip);
                const executionError = yield* Test.all(suite, {variant}).pipe(
                    Stream.runDrain,
                    Effect.flip,
                );
                t.expect({
                    selection: selectionError._tag,
                    execution: executionError._tag,
                    cases,
                    programs,
                    evaluations,
                }).toEqual({
                    selection: tag,
                    execution: tag,
                    cases: 0,
                    programs: 0,
                    evaluations: 0,
                });
            }),
    );

    t.it.effect('rejects an unknown selection for a single-program suite', () =>
        Effect.gen(function* () {
            const error = yield* Test.selectVariant(
                {
                    name: 'single-program',
                    schemas: numberSchemas,
                    testCases: [],
                    program: (input: number) => Effect.succeed(input),
                },
                'A',
            ).pipe(Effect.flip);
            t.expect(error._tag).toBe('TestVariantNotFound');
        }),
    );

    t.it.effect.each([' A ', 'A:B', 'Run:1'])(
        'preserves variant ID %s exactly',
        name =>
            Effect.gen(function* () {
                const program = (input: number) => Effect.succeed(input);
                const selected = yield* Test.selectVariant(
                    {
                        name: 'exact-id',
                        schemas: numberSchemas,
                        testCases: [],
                        variants: {[name]: {program}},
                    },
                    name,
                );
                t.expect(selected).toEqual({name, program});
            }),
    );

    t.it.effect.each(['', 'A,B', 'run:1'])(
        'rejects invalid variant ID %s before consuming cases',
        invalidName =>
            Effect.gen(function* () {
                let cases = 0;
                let programs = 0;
                const program = (input: number) =>
                    Effect.sync(() => {
                        programs++;
                        return input;
                    });
                const exit = yield* Test.all(
                    {
                        name: 'invalid-id',
                        schemas: numberSchemas,
                        testCases: Stream.fromEffect(
                            Effect.sync(() => {
                                cases++;
                                return {input: 1, expected: 1};
                            }),
                        ),
                        variants: {
                            A: {program},
                            [invalidName]: {program},
                        },
                    },
                    {variant: 'A'},
                ).pipe(Stream.runDrain, Effect.exit);
                t.expect({defect: Exit.hasDies(exit), cases, programs}).toEqual(
                    {
                        defect: true,
                        cases: 0,
                        programs: 0,
                    },
                );
            }),
    );

    t.it.effect.each(['both', 'neither'] as const)(
        'rejects %s program definitions before consuming cases',
        shape =>
            Effect.gen(function* () {
                let cases = 0;
                let programs = 0;
                const program = (input: number) =>
                    Effect.sync(() => {
                        programs++;
                        return input;
                    });
                const shared = {
                    name: 'invalid-definition',
                    schemas: numberSchemas,
                    testCases: Stream.fromEffect(
                        Effect.sync(() => {
                            cases++;
                            return {input: 1, expected: 1};
                        }),
                    ),
                };
                const suite =
                    shape === 'both'
                        ? {...shared, program, variants: {A: {program}}}
                        : shared;
                // @ts-expect-error JavaScript callers can supply both forms or neither.
                const output = Test.all(suite, {variant: 'A'});
                const exit = yield* output.pipe(Stream.runDrain, Effect.exit);
                t.expect({defect: Exit.hasDies(exit), cases, programs}).toEqual(
                    {
                        defect: true,
                        cases: 0,
                        programs: 0,
                    },
                );
            }),
    );

    t.it.effect(
        'runs each variant independently and keeps shared case identities',
        () =>
            Effect.gen(function* () {
                const calls: string[] = [];
                const suite = {
                    name: 'independent-programs',
                    schemas: numberSchemas,
                    testCases: [
                        {input: 1, expected: 2},
                        {input: 1, expected: 2},
                        {input: 2, expected: 4},
                    ],
                    variants: {
                        A: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls.push(`A:${input}`);
                                    return input * 2;
                                }),
                        },
                        B: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls.push(`B:${input}`);
                                    return input * 3;
                                }),
                        },
                    },
                };
                const first = yield* Test.all(suite, {variant: 'A'}).pipe(
                    Stream.runCollect,
                );
                t.expect(calls).toEqual(['A:1', 'A:2']);
                const second = yield* Test.all(suite, {variant: 'B'}).pipe(
                    Stream.runCollect,
                );
                t.expect(calls).toEqual(['A:1', 'A:2', 'B:1', 'B:2']);
                t.expect(
                    first.map(({result, label}) => ({result, label})),
                ).toEqual([
                    {result: 2, label: 'TP'},
                    {result: 4, label: 'TP'},
                ]);
                t.expect(
                    second.map(({result, label}) => ({result, label})),
                ).toEqual([
                    {result: 3, label: 'FP'},
                    {result: 6, label: 'FP'},
                ]);
                t.expect(first.map(resultKey)).toEqual(second.map(resultKey));
            }),
    );
});

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
                        schemas: numberSchemas,
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
                schemas: numberSchemas,
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
                    schemas: {
                        testCase: {
                            input: Schema.Finite,
                            expected: Schema.Struct({amount: Schema.Finite}),
                        },
                        evaluation: {
                            result: Schema.String,
                            expected: Schema.Finite,
                        },
                    },
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
                const classify = makeClassify({
                    isEqual: Schema.toEquivalence(Schema.Finite),
                });
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
                        schemas: {
                            testCase: {
                                input: Schema.String,
                                expected: Schema.Struct({
                                    budget: Schema.Finite,
                                    authority: Schema.Finite,
                                    need: Schema.Finite,
                                    timeline: Schema.Finite,
                                }),
                            },
                            evaluation: numberSchemas.evaluation,
                        },
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
                    schemas: numberSchemas,
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
                schemas: numberSchemas,
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
                schemas: numberSchemas,
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
                variant: run.variant,
                state: run.state,
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
        variant: run.variant,
        state: run.state,
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

t.describe('saved run comparison', () => {
    t.it.effect(
        'matches case and key, compares decoded values, and includes added and removed results in saved order',
        () =>
            Effect.gen(function* () {
                const Value = Schema.Finite.pipe(
                    Schema.overrideToEquivalence(
                        () => (a, b) => Math.abs(a) === Math.abs(b),
                    ),
                );
                const schemas = {
                    testCase: {input: Schema.Finite},
                    evaluation: {result: Value, expected: Value},
                };
                const fromResults = [
                    ...['equal', 'result', 'expected', 'removed-key'].map(
                        (key, resultOrdering) =>
                            mkResult({
                                input: 1,
                                result: 1,
                                expected: 1,
                                label: 'TP',
                                timeMillis: 10,
                                key,
                                resultOrdering,
                            }),
                    ),
                    mkResult({
                        input: 2,
                        result: 1,
                        expected: 1,
                        label: 'TP',
                        timeMillis: 20,
                        key: 'label',
                        ordering: 1,
                    }),
                    mkResult({
                        input: 3,
                        result: 1,
                        expected: 1,
                        label: 'TP',
                        timeMillis: 30,
                        ordering: 2,
                    }),
                ];
                const toResults: TestResult<number, number, number>[] = [
                    {
                        ...fromResults[4],
                        id: 'changed-label',
                        label: 'FP',
                        ordering: 0,
                    },
                    mkResult({
                        input: 4,
                        result: 1,
                        expected: 1,
                        label: 'TP',
                        timeMillis: 40,
                        ordering: 1,
                    }),
                    {
                        ...fromResults[2],
                        id: 'changed-expected',
                        expected: 3,
                        ordering: 2,
                        resultOrdering: 0,
                    },
                    {
                        ...fromResults[0],
                        id: 'equivalent-values',
                        result: -1,
                        expected: -1,
                        tags: ['new-tag'],
                        timeMillis: 100,
                        ordering: 2,
                        resultOrdering: 1,
                    },
                    {
                        ...fromResults[1],
                        id: 'changed-result',
                        result: 2,
                        ordering: 2,
                        resultOrdering: 2,
                    },
                    mkResult({
                        input: 1,
                        result: 1,
                        expected: 1,
                        label: 'TP',
                        timeMillis: 10,
                        key: 'added-key',
                        ordering: 2,
                        resultOrdering: 3,
                    }),
                ];
                const from = yield* saveRun(
                    {name: 'comparison', variant: 'A'},
                    fromResults,
                    schemas,
                );
                const to = yield* saveRun(
                    {name: 'comparison', variant: 'B'},
                    A.reverse(toResults),
                    schemas,
                );
                const comparisons = yield* Test.compareRuns({
                    from,
                    to,
                    schemas,
                }).pipe(Stream.runCollect);
                t.expect(comparisons).toEqual([
                    {
                        _tag: 'Matched',
                        from: fromResults[4],
                        to: toResults[0],
                        changed: true,
                    },
                    {_tag: 'OnlyTo', to: toResults[1]},
                    {
                        _tag: 'Matched',
                        from: fromResults[2],
                        to: toResults[2],
                        changed: true,
                    },
                    {
                        _tag: 'Matched',
                        from: fromResults[0],
                        to: toResults[3],
                        changed: false,
                    },
                    {
                        _tag: 'Matched',
                        from: fromResults[1],
                        to: toResults[4],
                        changed: true,
                    },
                    {_tag: 'OnlyTo', to: toResults[5]},
                    {_tag: 'OnlyFrom', from: fromResults[3]},
                    {_tag: 'OnlyFrom', from: fromResults[5]},
                ]);
                t.expect(
                    yield* Test.compareRuns({from, to: from, schemas}).pipe(
                        Stream.runCollect,
                    ),
                ).toEqual(
                    fromResults.map(result => ({
                        _tag: 'Matched',
                        from: result,
                        to: result,
                        changed: false,
                    })),
                );
            }).pipe(Effect.provide(TestRepository.TestLayer)),
    );

    t.it.effect('keeps additions and removals across result batches', () =>
        Effect.gen(function* () {
            const rows = Array.from({length: 125}, (_, index) =>
                mkResult({
                    input: index,
                    result: index,
                    expected: index,
                    label: 'TP',
                    timeMillis: index + 1,
                    ordering: index,
                }),
            );
            const from = yield* saveRun(
                {name: 'batches', variant: 'A'},
                rows.slice(0, 110),
                numberSchemas,
            );
            const to = yield* saveRun(
                {name: 'batches', variant: 'B'},
                rows
                    .slice(50)
                    .filter(({input}) => input !== 70 && input !== 105),
                numberSchemas,
            );
            const comparisons = yield* Test.compareRuns({
                from,
                to,
                schemas: numberSchemas,
            }).pipe(Stream.runCollect);
            t.expect(comparisons).toEqual([
                ...rows
                    .slice(50, 110)
                    .filter(({input}) => input !== 70 && input !== 105)
                    .map(result => ({
                        _tag: 'Matched',
                        from: result,
                        to: result,
                        changed: false,
                    })),
                ...rows.slice(110).map(to => ({_tag: 'OnlyTo', to})),
                ...[...rows.slice(0, 50), rows[70], rows[105]].map(from => ({
                    _tag: 'OnlyFrom',
                    from,
                })),
            ]);
        }).pipe(Effect.provide(TestRepository.TestLayer)),
    );
});

t.describe('saved run summaries', () => {
    t.it.effect(
        'filters decoded results and counts each represented case time once across batches',
        () =>
            Effect.gen(function* () {
                const results = Array.from({length: 60}, (_, index) => [
                    mkResult({
                        input: index,
                        result: index,
                        expected: index,
                        label: 'TP',
                        timeMillis: index + 1,
                        ordering: index,
                        key: 'first',
                    }),
                    mkResult({
                        input: index,
                        result: -1,
                        expected: index,
                        label: 'FP',
                        timeMillis: index + 1,
                        ordering: index,
                        key: 'second',
                        resultOrdering: 1,
                    }),
                ]).flatMap((results, index) =>
                    index < 30 ? results.slice(0, 1) : results,
                );
                const run = yield* saveRun(
                    {name: 'summary', variant: 'A'},
                    results,
                    numberSchemas,
                );
                const all = yield* Test.summarizeRun({
                    run,
                    schemas: numberSchemas,
                });
                const filtered = yield* Test.summarizeRun({
                    run,
                    schemas: numberSchemas,
                    predicate: result =>
                        result.key === 'second' && result.input >= 30,
                });
                const empty = yield* Test.summarizeRun({
                    run,
                    schemas: numberSchemas,
                    predicate: () => false,
                });
                t.expect([all, filtered, empty]).toEqual([
                    {
                        run,
                        stats: new Stats({
                            TP: 60,
                            TN: 0,
                            FP: 30,
                            FN: 0,
                            total: 90,
                            testCases: 60,
                            precision: 2 / 3,
                            recall: 1,
                            timeMin: Option.some(1),
                            timeMax: Option.some(60),
                            timeMean: Option.some(30.5),
                            timeMedian: Option.some(30.5),
                        }),
                    },
                    {
                        run,
                        stats: new Stats({
                            TP: 0,
                            TN: 0,
                            FP: 30,
                            FN: 0,
                            total: 30,
                            testCases: 30,
                            precision: 0,
                            recall: 0,
                            timeMin: Option.some(31),
                            timeMax: Option.some(60),
                            timeMean: Option.some(45.5),
                            timeMedian: Option.some(45.5),
                        }),
                    },
                    {run, stats: Stats.empty()},
                ]);
            }).pipe(Effect.provide(TestRepository.TestLayer)),
    );

    t.it.effect(
        'summarizes a completed empty run with absent timing values',
        () =>
            Effect.gen(function* () {
                const run = yield* saveRun(
                    {name: 'empty', variant: 'A'},
                    [],
                    numberSchemas,
                );
                t.expect(
                    yield* Test.summarizeRun({run, schemas: numberSchemas}),
                ).toEqual({run, stats: Stats.empty()});
                t.expect(
                    yield* Test.compareRuns({
                        from: run,
                        to: run,
                        schemas: numberSchemas,
                    }).pipe(Stream.runCollect),
                ).toEqual([]);
            }).pipe(Effect.provide(TestRepository.TestLayer)),
    );

    t.it.effect.each(['Running', 'Failed'] as const)(
        'checks the saved %s state even when callers supply Complete metadata',
        state =>
            Effect.gen(function* () {
                const repository = yield* TestRepository;
                const complete = yield* saveRun(
                    {name: 'complete', variant: 'A'},
                    [],
                    numberSchemas,
                );
                const check = (saved: TestRun) =>
                    Effect.gen(function* () {
                        const run = new TestRun({
                            id: saved.id,
                            name: saved.name,
                            variant: saved.variant,
                            state: 'Complete',
                        });
                        const summary = yield* Test.summarizeRun({
                            run,
                            schemas: numberSchemas,
                        }).pipe(Effect.flip);
                        const from = yield* Test.compareRuns({
                            from: run,
                            to: complete,
                            schemas: numberSchemas,
                        }).pipe(Stream.runDrain, Effect.flip);
                        const to = yield* Test.compareRuns({
                            from: complete,
                            to: run,
                            schemas: numberSchemas,
                        }).pipe(Stream.runDrain, Effect.flip);
                        t.expect([summary, from, to]).toMatchObject(
                            Array.from({length: 3}, () => ({
                                _tag: 'TestRunIncomplete',
                                testRunId: saved.id,
                                testSuiteName: saved.name,
                                variant: saved.variant,
                            })),
                        );
                    });
                if (state === 'Running') {
                    yield* repository.withTestRun(
                        {name: 'incomplete', variant: 'A'},
                        check,
                    );
                } else {
                    yield* repository
                        .withTestRun({name: 'incomplete', variant: 'A'}, () =>
                            Effect.fail('failed'),
                        )
                        .pipe(Effect.flip);
                    const failed = Option.getOrThrow(
                        yield* repository.getLatestTestRun({
                            name: 'incomplete',
                            variant: 'A',
                        }),
                    );
                    yield* check(failed);
                }
            }).pipe(Effect.provide(TestRepository.TestLayer)),
    );
});
