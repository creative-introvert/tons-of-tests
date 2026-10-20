import {Command} from 'effect/cli';
import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Option, Result, Schema, Stdio, Stream} from 'effect';

import {_commit} from './commit.js';
import {diff as diffCommand} from './diff.js';
import {prepareReport} from './test-run.js';

const services = Layer.mergeAll(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
    Stdio.layerTest({}),
);
const add = (input: number) => Effect.succeed(input + 1);
const addTwo = (input: number) => Effect.succeed(input + 2);
const config = {
    dbPath: ':memory:',
    testSuite: {
        name: 'diff',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: [
            {input: 1, expected: 2},
            {input: 2, expected: 3},
        ],
        program: add,
    },
};

it.effect.each([
    {description: 'no baseline', baseline: false, program: add, inputs: [1, 2]},
    {
        description: 'unchanged results',
        baseline: true,
        program: add,
        inputs: [],
    },
    {
        description: 'all results changed',
        baseline: true,
        program: addTwo,
        inputs: [1, 2],
    },
    {
        description: 'one result changed',
        baseline: true,
        program: (input: number) =>
            Effect.succeed(input === 1 ? input + 2 : input + 1),
        inputs: [1],
    },
])(
    'diff selects the correct rows with $description',
    ({baseline, program, inputs}) =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            if (baseline) {
                yield* prepareReport({
                    mode: 'summarize',
                    config,
                    cached: false,
                });
                yield* _commit({config});
            }
            const report = yield* prepareReport({
                mode: 'diff',
                config: {...config, testSuite: {...config.testSuite, program}},
                cached: false,
            });
            const current = yield* repository.getOrCreateCurrentTestRun(
                config.testSuite.name,
            );
            const selected = yield* repository
                .getTestResultsStream(current, config.testSuite.schemas)
                .pipe(
                    Stream.filter(row =>
                        inputs.some(input => input === row.input),
                    ),
                    PT.Test.runCollectRecord(current),
                );
            const previous = yield* repository.getPreviousTestRun(
                config.testSuite.name,
            );
            const selectedPrevious = Option.isNone(previous)
                ? Option.none()
                : Option.some(
                      yield* repository
                          .getTestResultsStream(
                              previous.value,
                              config.testSuite.schemas,
                          )
                          .pipe(
                              Stream.filter(row =>
                                  inputs.some(input => input === row.input),
                              ),
                              PT.Test.runCollectRecord(previous.value),
                          ),
                  );
            expect({
                count: report.count,
                stats: report.stats,
                previous: report.previousStats,
                output: (yield* report.chunks.pipe(Stream.runCollect)).join(''),
            }).toEqual({
                count: inputs.length,
                stats: selected.stats,
                previous: Option.map(selectedPrevious, run => run.stats),
                output: yield* PT.Show.summarize({
                    schemas: config.testSuite.schemas,
                    testRun: selected,
                    previousTestRun: selectedPrevious,
                }),
            });
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect.each([
    {
        description: 'unchanged results',
        program: add,
        expected: {success: true, count: 0},
    },
    {
        description: 'changed results',
        program: addTwo,
        expected: {success: false, count: 2},
    },
])('--exit-on-diff handles $description', ({program, expected}) =>
    Effect.gen(function* () {
        yield* prepareReport({mode: 'summarize', config, cached: false});
        yield* _commit({config});
        const result = yield* Command.runWith(
            diffCommand({...config, testSuite: {...config.testSuite, program}}),
            {version: 'test', renderErrors: false},
        )(['--exit-on-diff']).pipe(Effect.result);
        expect(
            Result.match(result, {
                onSuccess: () => ({success: true, count: 0}),
                onFailure: error => ({
                    success: false,
                    count:
                        error._tag === 'DiffNonEmpty'
                            ? error.count
                            : error._tag,
                }),
            }),
        ).toEqual(expected);
    }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
    'a changed evaluation target is visible when result and label stay the same',
    () =>
        Effect.gen(function* () {
            const base = {
                ...config,
                testSuite: {
                    ...config.testSuite,
                    testCases: [{input: 1, expected: 5}],
                    evaluate: (result: number, expected: number) =>
                        [
                            {key: 'budget', result, expected, label: 'FP'},
                        ] as const,
                },
            };
            yield* prepareReport({
                mode: 'summarize',
                config: base,
                cached: false,
            });
            yield* _commit({config: base});
            const changed = {
                ...base,
                testSuite: {
                    ...base.testSuite,
                    evaluate: (result: number, expected: number) =>
                        [
                            {
                                key: 'budget',
                                result,
                                expected: expected * 2,
                                label: 'FP',
                            },
                        ] as const,
                },
            };
            const report = yield* prepareReport({
                mode: 'diff',
                config: changed,
                cached: false,
            });
            expect({
                count: report.count,
                FP: report.stats.FP,
                previousFP: Option.map(report.previousStats, stats => stats.FP),
            }).toEqual({count: 1, FP: 1, previousFP: Option.some(1)});
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
    'matches prior results before filtering labels and replaces stale cached keys',
    () =>
        Effect.gen(function* () {
            const expected = {budget: 100, need: 2};
            const classify = PT.Classify.makeClassify({
                isEqual: Schema.toEquivalence(Schema.Finite),
            });
            const base = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'grouped-diff',
                    schemas: {
                        testCase: {
                            input: Schema.String,
                            expected: Schema.Struct({
                                budget: Schema.Finite,
                                need: Schema.Finite,
                            }),
                        },
                        evaluation: {
                            result: Schema.Finite,
                            expected: Schema.Finite,
                        },
                    },
                    testCases: [
                        {input: 'call-1', expected, tags: ['enterprise', 'de']},
                    ],
                    program: (_: string) => Effect.succeed(expected),
                    evaluate: (
                        result: typeof expected,
                        target: typeof expected,
                    ) =>
                        [
                            {
                                key: 'budget',
                                result: result.budget,
                                expected: target.budget,
                                label: classify(result.budget, target.budget),
                            },
                            {
                                key: 'need',
                                result: result.need,
                                expected: target.need,
                                label: classify(result.need, target.need),
                            },
                        ] as const,
                },
            };
            yield* prepareReport({
                mode: 'summarize',
                config: base,
                cached: false,
            });
            yield* _commit({config: base});
            const changed = {
                ...base,
                testSuite: {
                    ...base.testSuite,
                    program: (_: string) =>
                        Effect.succeed({budget: 80, need: 2}),
                },
            };
            const filters = {
                keys: Option.some(['budget']),
                labels: Option.some(['FP'] as const),
                orTags: Option.some(['enterprise']),
                andTags: Option.some(['enterprise', 'de']),
            };
            const report = yield* prepareReport({
                mode: 'diff',
                config: changed,
                cached: false,
                ...filters,
            });
            const cachedDiff = yield* prepareReport({
                mode: 'diff',
                config: changed,
                cached: true,
                ...filters,
            });
            const cache = yield* prepareReport({
                mode: 'summarize',
                config: changed,
                cached: true,
            });
            expect({
                visible: report.count,
                delta: PT.Test.diff({
                    testRun: report,
                    previousTestRun: Option.map(
                        report.previousStats,
                        stats => ({stats}),
                    ),
                }),
                cachedCount: cache.count,
                cachedStats: cachedDiff.stats,
                cachedOutput: yield* cachedDiff.chunks.pipe(Stream.runCollect),
            }).toEqual({
                visible: 1,
                delta: {TP: -1, TN: 0, FP: 1, FN: 0, precision: -1, recall: -1},
                cachedCount: 2,
                cachedStats: report.stats,
                cachedOutput: yield* report.chunks.pipe(Stream.runCollect),
            });
            const budgetOnly = {
                ...changed,
                testSuite: {
                    ...changed.testSuite,
                    evaluate: (
                        result: typeof expected,
                        target: typeof expected,
                    ) =>
                        [
                            changed.testSuite.evaluate(result, target)[0],
                        ] as const,
                },
            };
            yield* prepareReport({
                mode: 'diff',
                config: budgetOnly,
                cached: false,
            });
            const replacement = yield* prepareReport({
                mode: 'summarize',
                config: budgetOnly,
                cached: true,
            });
            expect(replacement.count).toBe(1);
        }).pipe(Effect.scoped, Effect.provide(services)),
);
