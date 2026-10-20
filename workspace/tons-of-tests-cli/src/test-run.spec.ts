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
    '%s reruns an incomplete cache and refuses to commit it',
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
                        if (input === 55 && (yield* Ref.get(shouldFail))) {
                            return yield* Effect.fail(failure);
                        }
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

            const run =
                yield* repository.getOrCreateCurrentTestRun('incomplete');
            const partial = yield* repository
                .getTestResultsStream(run, config.testSuite.schemas)
                .pipe(Stream.runCollect);
            const commitError = yield* repository
                .commitCurrentTestRun({
                    name: 'incomplete',
                    hash: 'invalid-baseline',
                })
                .pipe(Effect.flip);
            expect({
                complete: yield* repository.isComplete(run),
                saved: partial.length,
                commit: commitError._tag,
                baseline: yield* repository.getLastTestRunHash('incomplete'),
            }).toEqual({
                complete: false,
                saved: 50,
                commit: 'TestRunIncomplete',
                baseline: Option.none(),
            });

            yield* Ref.set(shouldFail, false);
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            const complete = yield* repository
                .getTestResultsStream(run, config.testSuite.schemas)
                .pipe(Stream.runCollect);
            expect({
                complete: yield* repository.isComplete(run),
                saved: complete.length,
                calls: yield* Ref.get(calls),
            }).toEqual({complete: true, saved: 60, calls: 116});
        }).pipe(Effect.provide(services)),
);

it.effect('interruption leaves saved batches uncommittable', () =>
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

        const run = yield* repository.getOrCreateCurrentTestRun('interrupted');
        const results = yield* repository
            .getTestResultsStream(run, config.testSuite.schemas)
            .pipe(Stream.runCollect);
        const error = yield* repository
            .commitCurrentTestRun({
                name: 'interrupted',
                hash: 'invalid-baseline',
            })
            .pipe(Effect.flip);
        expect({
            complete: yield* repository.isComplete(run),
            saved: results.length,
            error: error._tag,
        }).toEqual({complete: false, saved: 50, error: 'TestRunIncomplete'});
    }).pipe(Effect.provide(services)),
);

it.effect.each(['summarize', 'diff'] as const)(
    '%s can reuse a successfully completed empty suite',
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
            yield* effectNoDeps(config, ['node', 'suite', command, '--cached']);
            const run = yield* repository.getOrCreateCurrentTestRun('empty');
            expect({
                complete: yield* repository.isComplete(run),
                reads: yield* Ref.get(reads),
            }).toEqual({complete: true, reads: 1});
        }).pipe(Effect.provide(services)),
);

it.effect('public CLI calls share the caller-provided repository', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const config = {
            dbPath: ':memory:',
            testSuite: {
                name: 'shared',
                schemas: numberSchemas,
                testCases: [{input: 1, expected: 1}],
                program: (input: number) => Effect.succeed(input),
            },
        };
        yield* effectNoDeps(config, ['node', 'suite', 'summarize']);
        const run = yield* repository.getOrCreateCurrentTestRun('shared');
        yield* effectNoDeps(config, ['node', 'suite', 'commit']);
        const previous = yield* repository.getPreviousTestRun('shared');
        const current = yield* repository.getOrCreateCurrentTestRun('shared');
        expect({
            committedRun: Option.map(previous, previous => previous.id),
            hasHash: Option.isSome(
                yield* repository.getLastTestRunHash('shared'),
            ),
            freshCurrent: current.id !== run.id,
            currentHasResults: yield* repository.hasResults(current),
        }).toEqual({
            committedRun: Option.some(run.id),
            hasHash: true,
            freshCurrent: true,
            currentHasResults: false,
        });
    }).pipe(Effect.provide(services)),
);
