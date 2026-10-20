import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import {expect, it} from '@effect/vitest';
import {
    Deferred,
    Effect,
    Fiber,
    Layer,
    Option,
    Ref,
    Result,
    Schema,
    Stdio,
    Stream,
} from 'effect';

import {effectNoDeps} from './index.js';

const numberSchemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};
const services = Layer.mergeAll(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
    Stdio.layerTest({}),
);

it.effect.each(['summarize', 'diff'] as const)(
    '%s creates independent attempts after a failed cache',
    command =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const shouldFail = yield* Ref.make(true);
            const calls = yield* Ref.make(0);
            const failure = {_tag: 'InferenceError'} as const;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'incomplete',
                    schemas: numberSchemas,
                    testCases: Array.from({length: 60}, (_, input) => ({
                        input,
                        expected: input,
                    })),
                    program: Effect.fnUntraced(function* (input: number) {
                        yield* Ref.update(calls, n => n + 1);
                        if (input === 55 && (yield* Ref.get(shouldFail)))
                            return yield* Effect.fail(failure);
                        return input;
                    }),
                },
            };
            const first = yield* effectNoDeps(config, [
                'node',
                'suite',
                command,
            ]).pipe(Effect.result);
            expect(first).toEqual(Result.fail(failure));
            const failed = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'incomplete',
                    variant: 'default',
                }),
            );
            const partial = yield* repository
                .getTestResultsStream(failed, numberSchemas)
                .pipe(Stream.runCollect);
            const error = yield* effectNoDeps(config, [
                'node',
                'suite',
                'commit',
            ]).pipe(Effect.flip);
            expect({
                state: failed.state,
                saved: partial.length,
                error: error._tag,
            }).toEqual({
                state: 'Failed',
                saved: 50,
                error: 'TestRunIncomplete',
            });
            yield* Ref.set(shouldFail, false);
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            const complete = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'incomplete',
                    variant: 'default',
                }),
            );
            expect({
                different: complete.id !== failed.id,
                state: complete.state,
                calls: yield* Ref.get(calls),
                previous: yield* repository
                    .getTestResultsStream(failed, numberSchemas)
                    .pipe(Stream.runCollect),
            }).toEqual({
                different: true,
                state: 'Complete',
                calls: 116,
                previous: partial,
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff'] as const)(
    '%s starts a new run when the latest attempt is Running',
    command =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const started = yield* Deferred.make<PT.TestRepository.TestRun>();
            const pending = yield* Effect.forkChild(
                repository.withTestRun(
                    {name: 'running', variant: 'default'},
                    run =>
                        Deferred.succeed(started, run).pipe(
                            Effect.andThen(Effect.never),
                        ),
                ),
            );
            const running = yield* Deferred.await(started);
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'running',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (input: number) => Effect.succeed(input),
                },
            };
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            const latest = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'running',
                    variant: 'default',
                }),
            );
            expect({
                different: latest.id !== running.id,
                state: latest.state,
                oldState: Option.map(
                    yield* repository.getTestRun(running.id),
                    run => run.state,
                ),
            }).toEqual({
                different: true,
                state: 'Complete',
                oldState: Option.some('Running'),
            });
            yield* Fiber.interrupt(pending);
        }).pipe(Effect.provide(services)),
);

it.effect('interruption leaves saved batches in a failed attempt', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const started = yield* Deferred.make<void>();
        const config = {
            dbPath: ':memory:',
            testSuite: {
                name: 'interrupted',
                schemas: numberSchemas,
                testCases: Array.from({length: 60}, (_, input) => ({
                    input,
                    expected: input,
                })),
                program: (input: number) =>
                    input === 55
                        ? Deferred.succeed(started, undefined).pipe(
                              Effect.andThen(Effect.never),
                          )
                        : Effect.succeed(input),
            },
        };
        const fiber = yield* Effect.forkChild(
            effectNoDeps(config, ['node', 'suite', 'summarize']),
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const run = Option.getOrThrow(
            yield* repository.getLatestTestRun({
                name: 'interrupted',
                variant: 'default',
            }),
        );
        const results = yield* repository
            .getTestResultsStream(run, numberSchemas)
            .pipe(Stream.runCollect);
        const error = yield* repository.commitTestRun(run.id).pipe(Effect.flip);
        expect({
            state: run.state,
            saved: results.length,
            error: error._tag,
        }).toEqual({state: 'Failed', saved: 50, error: 'TestRunIncomplete'});
    }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff'] as const)(
    '%s reuses a completed empty baseline',
    command =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const reads = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'empty',
                    schemas: numberSchemas,
                    testCases: Stream.fromEffect(
                        Ref.update(reads, n => n + 1),
                    ).pipe(Stream.drain),
                    program: (input: number) => Effect.succeed(input),
                },
            };
            yield* effectNoDeps(config, ['node', 'suite', command]);
            yield* effectNoDeps(config, ['node', 'suite', 'commit']);
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            const attempts = yield* repository.listTestRuns({
                name: 'empty',
                limit: 100,
            });
            expect({
                states: attempts.map(run => [run.state, run.isBaseline]),
                reads: yield* Ref.get(reads),
            }).toEqual({states: [['Complete', true]], reads: 1});
        }).pipe(Effect.provide(services)),
);

it.effect(
    'public calls keep variant execution, cache reuse, and baselines separate',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const calls: string[] = [];
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'variants',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    variants: {
                        A: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls.push('A');
                                    return input;
                                }),
                        },
                        B: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls.push('B');
                                    return input + 1;
                                }),
                        },
                    },
                },
            };
            for (const variant of ['A', 'B']) {
                yield* effectNoDeps(config, [
                    'node',
                    'suite',
                    'summarize',
                    '--variant',
                    variant,
                ]);
                yield* effectNoDeps(config, [
                    'node',
                    'suite',
                    'commit',
                    '--variant',
                    variant,
                ]);
                yield* effectNoDeps(config, [
                    'node',
                    'suite',
                    'summarize',
                    '--variant',
                    variant,
                    '--cached',
                ]);
            }
            const before = yield* repository.listTestRuns({
                name: 'variants',
                limit: 100,
            });
            yield* effectNoDeps(config, [
                'node',
                'suite',
                'summarize',
                '--variant',
                'A',
            ]);
            const after = yield* repository.listTestRuns({
                name: 'variants',
                limit: 100,
            });
            expect({
                calls,
                before: before.map(run => [run.variant, run.isBaseline]),
                after: after.map(run => [run.variant, run.isBaseline]),
                fresh: after[0].id !== before[1].id,
            }).toEqual({
                calls: ['A', 'B', 'A'],
                before: [
                    ['B', true],
                    ['A', true],
                ],
                after: [
                    ['A', false],
                    ['B', true],
                    ['A', true],
                ],
                fresh: true,
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each([
    {
        variants: {A: {program: (input: number) => Effect.succeed(input)}},
        args: [],
        tag: 'TestVariantRequired',
    },
    {
        variants: {A: {program: (input: number) => Effect.succeed(input)}},
        args: ['--variant', 'missing'],
        tag: 'TestVariantNotFound',
    },
    {variants: {}, args: ['--variant', 'A'], tag: 'TestVariantNotFound'},
])(
    'rejects invalid execution selection before saving an attempt ($tag)',
    ({variants, args, tag}) =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const reads = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'selection',
                    schemas: numberSchemas,
                    variants,
                    testCases: Stream.fromEffect(
                        Ref.update(reads, n => n + 1),
                    ).pipe(Stream.drain),
                },
            };
            const error = yield* effectNoDeps(config, [
                'node',
                'suite',
                'summarize',
                ...args,
            ]).pipe(Effect.flip);
            expect({
                tag: error._tag,
                reads: yield* Ref.get(reads),
                attempts: yield* repository.listTestRuns({
                    name: 'selection',
                    limit: 100,
                }),
            }).toEqual({tag, reads: 0, attempts: []});
        }).pipe(Effect.provide(services)),
);

it.effect(
    'saved commands reject Running and Failed references without executing or changing history',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const started = yield* Deferred.make<PT.TestRepository.TestRun>();
            const pending = yield* Effect.forkChild(
                repository.withTestRun(
                    {name: 'saved-only', variant: 'A'},
                    run =>
                        Deferred.succeed(started, run).pipe(
                            Effect.andThen(Effect.never),
                        ),
                ),
            );
            const running = yield* Deferred.await(started);
            yield* repository
                .withTestRun({name: 'saved-only', variant: 'A'}, () =>
                    Effect.fail('failed'),
                )
                .pipe(Effect.result);
            const failed = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'saved-only',
                    variant: 'A',
                }),
            );
            const complete = (yield* repository.withTestRun(
                {name: 'saved-only', variant: 'A'},
                () => Effect.void,
            )).run;
            yield* repository.commitTestRun(complete.id);
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'saved-only',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    variants: {
                        A: {
                            program: (input: number) =>
                                Effect.sync(() => {
                                    calls++;
                                    return input;
                                }),
                        },
                    },
                },
            };
            const before = yield* repository.listTestRuns({
                name: 'saved-only',
                limit: 100,
            });
            for (const run of [running, failed]) {
                for (const args of [
                    ['stats', '--runs', `run:${run.id}`],
                    [
                        'diff',
                        '--from',
                        `run:${run.id}`,
                        '--to',
                        `run:${complete.id}`,
                    ],
                    [
                        'diff',
                        '--from',
                        `run:${complete.id}`,
                        '--to',
                        `run:${run.id}`,
                    ],
                    ['commit', '--run', `run:${run.id}`],
                ]) {
                    const error = yield* effectNoDeps(config, [
                        'node',
                        'suite',
                        ...args,
                    ]).pipe(Effect.flip);
                    expect(error._tag).toBe('TestRunIncomplete');
                }
            }
            expect({
                calls,
                saved: yield* repository.listTestRuns({
                    name: 'saved-only',
                    limit: 100,
                }),
            }).toEqual({calls: 0, saved: before});
            yield* Fiber.interrupt(pending);
        }).pipe(Effect.provide(services)),
);

it.effect(
    'saved CLI comparisons and summaries preserve codec failures and never rerun a program',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            let calls = 0;
            const source = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'original-suite',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            yield* effectNoDeps(source, ['node', 'suite', 'summarize']);
            yield* effectNoDeps(source, ['node', 'suite', 'commit']);
            const run = Option.getOrThrow(
                yield* repository.getBaselineTestRun({
                    name: 'original-suite',
                    variant: 'default',
                }),
            );
            const reader = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'reader-suite',
                    schemas: {
                        testCase: {
                            input: Schema.String,
                            expected: Schema.String,
                        },
                        evaluation: {
                            result: Schema.String,
                            expected: Schema.String,
                        },
                    },
                    testCases: [{input: 'one', expected: 'one'}],
                    program: (input: string) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            const before = yield* repository.listTestRuns({
                name: 'original-suite',
                limit: 100,
            });
            for (const args of [
                ['stats', '--runs', `run:${run.id}`],
                ['diff', '--from', `run:${run.id}`, '--to', `run:${run.id}`],
            ]) {
                const error = yield* effectNoDeps(reader, [
                    'node',
                    'suite',
                    ...args,
                ]).pipe(Effect.flip);
                expect(error._tag).toBe('TestValueError');
                if (error._tag === 'TestValueError') {
                    expect({
                        suite: error.suite,
                        field: error.field,
                        operation: error.operation,
                    }).toEqual({
                        suite: 'original-suite',
                        field: 'testCase.input',
                        operation: 'decode',
                    });
                }
            }
            expect({
                calls,
                saved: yield* repository.listTestRuns({
                    name: 'original-suite',
                    limit: 100,
                }),
                reader: yield* repository.listTestRuns({
                    name: 'reader-suite',
                    limit: 100,
                }),
            }).toEqual({calls: 1, saved: before, reader: []});
        }).pipe(Effect.provide(services)),
);
