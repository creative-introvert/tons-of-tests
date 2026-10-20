import {Command} from 'effect/cli';
import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import {expect, it} from '@effect/vitest';
import {
    Effect,
    Layer,
    Option,
    Result,
    Schema,
    Sink,
    Stdio,
    Stream,
} from 'effect';

import {_commit} from './commit.js';
import {diff as diffCommand} from './diff.js';
import {prepareReport} from './test-run.js';
import {effectNoDeps} from './index.js';

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
            const current = report.run;
            const selected = yield* repository
                .getTestResultsStream(current, config.testSuite.schemas)
                .pipe(
                    Stream.filter(row =>
                        inputs.some(input => input === row.input),
                    ),
                    PT.Test.runCollectRecord(current),
                );
            const previous = yield* repository.getBaselineTestRun({
                name: config.testSuite.name,
                variant: 'default',
            });
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
            }).toEqual({
                count: inputs.length,
                stats: selected.stats,
                previous: Option.map(selectedPrevious, run => run.stats),
            });
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('an empty committed baseline is still a baseline', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const {run} = yield* repository.withTestRun(
            {name: config.testSuite.name, variant: 'default'},
            () => Effect.void,
        );
        yield* repository.commitTestRuns([run]);
        const report = yield* prepareReport({
            config,
            mode: 'diff',
            cached: false,
        });
        expect({
            count: report.count,
            previous: Option.map(report.previousStats, stats => stats.total),
        }).toEqual({count: 2, previous: Option.some(0)});
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

it.effect.each([
    {changed: ['A'], filters: [], count: 1},
    {changed: ['B'], filters: [], count: 1},
    {changed: ['A', 'B'], filters: [], count: 2},
    {changed: ['A', 'B'], filters: ['--keys', 'missing'], count: 0},
])(
    'renders every variant before applying --exit-on-diff ($changed, $count)',
    ({changed, filters, count}) =>
        Effect.gen(function* () {
            const baseline = {
                ...config,
                testSuite: {
                    name: 'multi-diff',
                    schemas: config.testSuite.schemas,
                    testCases: [{input: 1, expected: 1}],
                    variants: {
                        A: {program: (input: number) => Effect.succeed(input)},
                        B: {program: (input: number) => Effect.succeed(input)},
                    },
                },
            };
            yield* effectNoDeps(baseline, ['node', 'suite', 'summarize']);
            yield* effectNoDeps(baseline, ['node', 'suite', 'commit']);
            const calls: string[] = [];
            const program = (variant: string) => (input: number) =>
                Effect.sync(() => {
                    calls.push(variant);
                    return changed.includes(variant) ? input + 1 : input;
                });
            const output: string[] = [];
            const result = yield* effectNoDeps(
                {
                    ...baseline,
                    testSuite: {
                        ...baseline.testSuite,
                        variants: {
                            A: {program: program('A')},
                            B: {program: program('B')},
                        },
                    },
                },
                ['node', 'suite', 'diff', '--exit-on-diff', ...filters],
            ).pipe(
                Effect.provide(
                    Stdio.layerTest({
                        stdout: () =>
                            Sink.forEach(chunk =>
                                Effect.sync(() => {
                                    output.push(String(chunk));
                                }),
                            ),
                    }),
                ),
                Effect.result,
            );
            expect({
                calls,
                outcome: Result.match(result, {
                    onSuccess: () => 0,
                    onFailure: error =>
                        error._tag === 'DiffNonEmpty'
                            ? error.count
                            : error._tag,
                }),
                rendered: output.join('').match(/to: multi-diff \/ [AB]/g),
            }).toEqual({
                calls: ['A', 'B'],
                outcome: count,
                rendered: ['to: multi-diff / A', 'to: multi-diff / B'],
            });
        }).pipe(Effect.provide(services)),
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

it.effect(
    'saved references include removals and do not run programs or change baselines',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            let calls = 0;
            const base = {
                ...config,
                testSuite: {
                    name: config.testSuite.name,
                    schemas: config.testSuite.schemas,
                    testCases: config.testSuite.testCases,
                    variants: {
                        A: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls++;
                                    return input + 1;
                                }),
                        },
                        B: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls++;
                                    return input + 1;
                                }),
                        },
                    },
                },
            };
            const old = yield* prepareReport({
                config: base,
                mode: 'summarize',
                cached: false,
                variant: 'A',
            });
            const [savedOld] = yield* repository.commitTestRuns([old.run]);
            const current = yield* prepareReport({
                config: {
                    ...base,
                    testSuite: {
                        ...base.testSuite,
                        testCases: [base.testSuite.testCases[0]],
                    },
                },
                mode: 'summarize',
                cached: false,
                variant: 'B',
            });
            const [savedCurrent] = yield* repository.commitTestRuns([
                current.run,
            ]);
            yield* prepareReport({
                config: base,
                mode: 'summarize',
                cached: false,
                variant: 'A',
            });
            yield* prepareReport({
                config: base,
                mode: 'summarize',
                cached: false,
                variant: 'B',
            });
            const external = yield* prepareReport({
                config: {
                    ...base,
                    testSuite: {
                        ...base.testSuite,
                        name: 'other-suite',
                        testCases: [base.testSuite.testCases[0]],
                    },
                },
                mode: 'summarize',
                cached: false,
                variant: 'A',
            });
            const [savedExternal] = yield* repository.commitTestRuns([
                external.run,
            ]);
            const before = yield* repository.listTestRuns({
                name: config.testSuite.name,
                limit: 100,
            });
            const otherBefore = yield* repository.listTestRuns({
                name: 'other-suite',
                limit: 100,
            });
            for (const references of [
                {from: 'A', to: 'B', selected: savedCurrent},
                {
                    from: `run:${savedOld.id}`,
                    to: `run:${savedCurrent.id}`,
                    selected: savedCurrent,
                },
                {
                    from: `run:${savedOld.id}`,
                    to: `run:${savedExternal.id}`,
                    selected: savedExternal,
                },
            ]) {
                const output: string[] = [];
                const error = yield* effectNoDeps(base, [
                    'node',
                    'suite',
                    'diff',
                    '--from',
                    references.from,
                    '--to',
                    references.to,
                    '--exit-on-diff',
                ]).pipe(
                    Effect.provide(
                        Stdio.layerTest({
                            stdout: () =>
                                Sink.forEach(chunk =>
                                    Effect.sync(() => {
                                        output.push(String(chunk));
                                    }),
                                ),
                        }),
                    ),
                    Effect.flip,
                );
                expect(
                    error._tag === 'DiffNonEmpty' ? error.count : error._tag,
                ).toBe(1);
                expect(output.join('')).toContain(
                    `from: ${savedOld.name} / ${savedOld.variant} / run:${savedOld.id}`,
                );
                expect(output.join('')).toContain(
                    `to: ${references.selected.name} / ${references.selected.variant} / run:${references.selected.id}`,
                );
                expect(output.join('')).toContain('removed');
            }
            expect({
                calls,
                runs: yield* repository.listTestRuns({
                    name: config.testSuite.name,
                    limit: 100,
                }),
                other: yield* repository.listTestRuns({
                    name: 'other-suite',
                    limit: 100,
                }),
            }).toEqual({calls: 8, runs: before, other: otherBefore});
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect.each([
    {args: ['--from', 'A'], tag: 'InvalidCommandOptions'},
    {args: ['--to', 'B'], tag: 'InvalidCommandOptions'},
    {
        args: ['--from', 'A', '--to', 'B', '--variant', 'A'],
        tag: 'InvalidCommandOptions',
    },
    {
        args: ['--from', 'A', '--to', 'B', '--cached'],
        tag: 'InvalidCommandOptions',
    },
    {args: ['--from', 'run:0', '--to', 'B'], tag: 'ShowHelp'},
    {args: ['--from', 'run:1x', '--to', 'B'], tag: 'ShowHelp'},
    {args: ['--from', 'run:9007199254740992', '--to', 'B'], tag: 'ShowHelp'},
    {args: ['--from', 'A', '--to', 'B'], tag: 'TestBaselineNotFound'},
    {args: ['--from', 'run:999', '--to', 'B'], tag: 'TestRunNotFound'},
])('rejects invalid diff selections before execution ($tag)', ({args, tag}) =>
    Effect.gen(function* () {
        let calls = 0;
        const selected = {
            ...config,
            testSuite: {
                ...config.testSuite,
                program: (input: number) =>
                    Effect.sync(() => {
                        calls++;
                        return input;
                    }),
            },
        };
        const error = yield* Command.runWith(diffCommand(selected), {
            version: 'test',
            renderErrors: false,
        })(args).pipe(Effect.flip);
        const repository = yield* PT.TestRepository.TestRepository;
        expect({
            tag: error._tag,
            calls,
            runs: yield* repository.listTestRuns({
                name: selected.testSuite.name,
                limit: 100,
            }),
        }).toEqual({tag, calls: 0, runs: []});
    }).pipe(Effect.provide(services)),
);
