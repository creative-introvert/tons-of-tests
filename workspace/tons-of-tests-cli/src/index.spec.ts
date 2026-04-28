import * as t from '@effect/vitest';
import {Cause, Context, Effect, Exit, Option, Ref, Stream} from 'effect';

import {DiffNonEmpty} from './diff.js';
import {effect as cliEffect} from './index.js';

class Multiplier extends Context.Tag('Multiplier')<
    Multiplier,
    {
        readonly value: number;
        readonly hits: Ref.Ref<number>;
    }
>() {}

t.describe('CLI.effect', () => {
    t.test.each([
        {
            description:
                'runs the selected subcommand with array test cases and caller-provided dependencies',
            args: ['node', 'test', 'summarize'] as const,
            testCases: [
                {input: 1, expected: 3},
                {input: 2, expected: 4},
            ],
            expectedHits: 2,
        },
        {
            description:
                'runs the selected subcommand with stream test cases and caller-provided dependencies',
            args: ['node', 'test', 'summarize'] as const,
            testCases: Stream.fromIterable([
                {input: 1, expected: 3},
                {input: 2, expected: 4},
            ]),
            expectedHits: 2,
        },
    ])('$description', async ({args, testCases, expectedHits}) => {
        await Effect.gen(function* () {
            const hits = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'cli-effect-deps',
                    testCases,
                    program: (input: number) =>
                        Effect.gen(function* () {
                            const multiplier = yield* Multiplier;
                            yield* Ref.update(multiplier.hits, _ => _ + 1);
                            return input + multiplier.value;
                        }),
                },
            };

            yield* cliEffect(config, args).pipe(
                Effect.provideService(Multiplier, {value: 2, hits}),
            );

            t.expect(yield* Ref.get(hits)).toBe(expectedHits);
        }).pipe(Effect.runPromise);
    });

    t.test.each([
        {
            description: 'keeps DiffNonEmpty in the error channel',
            args: ['node', 'test', 'diff', '--exit-on-diff'] as const,
        },
    ])('$description', async ({args}) => {
        await Effect.gen(function* () {
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'cli-effect-diff-non-empty',
                    testCases: [{input: 1, expected: 2}],
                    program: (input: number) => Effect.succeed(input + 1),
                },
            };

            const exit = yield* cliEffect(config, args).pipe(Effect.exit);

            t.expect(Exit.isFailure(exit)).toBe(true);
            const err = Exit.isFailure(exit)
                ? Option.getOrNull(Cause.failureOption(exit.cause))
                : null;
            t.expect(err).toBeInstanceOf(DiffNonEmpty);
        }).pipe(Effect.runPromise);
    });
});
