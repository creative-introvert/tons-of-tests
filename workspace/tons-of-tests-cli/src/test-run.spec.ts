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

it.effect.each(['summarize', 'diff', 'stats'] as const)(
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
                previous: yield* repository.getTestRun(failed),
            }).toEqual({
                different: true,
                state: 'Complete',
                calls: 116,
                previous: Option.none(),
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff', 'stats'] as const)(
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
                    yield* repository.getTestRun(running),
                    run => run.state,
                ),
            }).toEqual({
                different: true,
                state: 'Complete',
                oldState: Option.none(),
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
        const error = yield* repository.commitTestRuns([run]).pipe(Effect.flip);
        expect({
            state: run.state,
            saved: results.length,
            error: error._tag,
        }).toEqual({state: 'Failed', saved: 50, error: 'TestRunIncomplete'});
    }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff', 'stats'] as const)(
    '%s reuses a completed empty cache after commit',
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
                cache: Option.map(
                    yield* repository.getLatestTestRun({
                        name: 'variants',
                        variant: 'A',
                    }),
                    run => run.store,
                ),
            }).toEqual({
                calls: ['A', 'B', 'A'],
                before: [
                    ['B', true],
                    ['A', true],
                ],
                after: [
                    ['B', true],
                    ['A', true],
                ],
                cache: Option.some('cache'),
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff', 'stats'] as const)(
    '%s runs variants in declaration order and reopens the case stream',
    command =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const calls: string[] = [];
            let reads = 0;
            const program = (variant: string) => (input: number) =>
                Effect.sync(() => {
                    calls.push(`${variant}:${input}`);
                    return input;
                });
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'ordered',
                    schemas: numberSchemas,
                    variants: {
                        B: {program: program('B')},
                        A: {program: program('A')},
                    },
                    testCases: Stream.suspend(() => {
                        reads++;
                        return Stream.fromIterable([
                            {input: 1, expected: 1},
                            {input: 2, expected: 2},
                        ]);
                    }),
                },
            };
            yield* effectNoDeps(config, ['node', 'suite', command]);
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            expect({calls, reads}).toEqual({
                calls: ['B:1', 'B:2', 'A:1', 'A:2'],
                reads: 2,
            });
            yield* repository
                .withTestRun({name: 'ordered', variant: 'A'}, () =>
                    Effect.fail('incomplete'),
                )
                .pipe(Effect.result);
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            expect({calls, reads}).toEqual({
                calls: ['B:1', 'B:2', 'A:1', 'A:2', 'A:1', 'A:2'],
                reads: 3,
            });
            yield* effectNoDeps(config, ['node', 'suite', command]);
            expect({calls, reads}).toEqual({
                calls: [
                    'B:1',
                    'B:2',
                    'A:1',
                    'A:2',
                    'A:1',
                    'A:2',
                    'B:1',
                    'B:2',
                    'A:1',
                    'A:2',
                ],
                reads: 5,
            });
            expect(
                yield* repository.listTestRuns({name: 'ordered', limit: 100}),
            ).toEqual([]);
        }).pipe(Effect.provide(services)),
);

it.effect.each([
    {variants: {}, args: [], tag: 'InvalidCommandOptions'},
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
    'saved commands cannot select cached Running or Failed attempts',
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
                    ['diff', '--from', `run:${run.id}`, '--to', 'run:999'],
                    ['diff', '--from', 'run:999', '--to', `run:${run.id}`],
                    ['commit', '--run', `run:${run.id}`],
                ]) {
                    const error = yield* effectNoDeps(config, [
                        'node',
                        'suite',
                        ...args,
                    ]).pipe(Effect.flip);
                    expect(error._tag).toBe('TestRunNotFound');
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
