import * as t from '@effect/vitest';
import * as PT from '@creative-introvert/tons-of-tests';
import {Context, Effect, Ref, Stream} from 'effect';

import {DiffNonEmpty} from './diff.js';
import {effect as cliEffect} from './index.js';

class Multiplier extends Context.Service<
    Multiplier,
    {
        readonly value: number;
        readonly hits: Ref.Ref<number>;
    }
>()('Multiplier') {}

t.describe('CLI.effect', () => {
    t.it.effect.each([
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
    ])('$description', ({args, testCases, expectedHits}) =>
        Effect.gen(function* () {
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
        }),
    );

    t.it.effect.each([
        {
            description: 'accepts any listed result key',
            input: ['--keys', 'budget,need'],
            expectedCount: 4,
        },
        {
            description: 'combines key, label, and case tag filters',
            input: [
                '--keys',
                'budget,need',
                '--labels',
                'FP',
                '--tags',
                'enterprise,missing',
                '--all-tags',
                'enterprise,de',
            ],
            expectedCount: 1,
        },
        {
            description: 'requires every tag in --all-tags',
            input: ['--tags', 'enterprise,smb', '--all-tags', 'enterprise,de'],
            expectedCount: 2,
        },
        {
            description: 'accepts any listed label',
            input: ['--keys', 'budget', '--labels', 'FP,TP'],
            expectedCount: 2,
        },
        {
            description: 'succeeds when no result key matches',
            input: ['--keys', 'missing'],
            expectedCount: 0,
        },
    ])('diff $description', ({input, expectedCount}) =>
        Effect.gen(function* () {
            const expected = {budget: 100, need: 2};
            const classify = PT.Classify.makeClassify({
                isEqual: PT.Classify.defaultIsEqual,
            });
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'cli-result-filters',
                    testCases: [
                        {input: 'call-1', expected, tags: ['enterprise', 'de']},
                        {input: 'call-2', expected, tags: ['smb', 'de']},
                    ],
                    program: (_: string) =>
                        Effect.succeed({budget: 80, need: 2}),
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

            const count = yield* cliEffect(config, [
                'node',
                'test',
                'diff',
                '--exit-on-diff',
                ...input,
            ]).pipe(
                Effect.catchTag('DiffNonEmpty', error =>
                    Effect.succeed(error.count),
                ),
                Effect.map(count => count ?? 0),
            );
            t.expect(count).toBe(expectedCount);
        }),
    );

    t.it.effect.each([
        {
            description: 'keeps DiffNonEmpty in the error channel',
            args: ['node', 'test', 'diff', '--exit-on-diff'] as const,
        },
    ])('$description', ({args}) =>
        Effect.gen(function* () {
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'cli-effect-diff-non-empty',
                    testCases: [{input: 1, expected: 2}],
                    program: (input: number) => Effect.succeed(input + 1),
                },
            };

            const err = yield* Effect.flip(cliEffect(config, args));
            t.expect(err).toBeInstanceOf(DiffNonEmpty);
        }),
    );

    t.it.effect.each([
        {description: 'unknown label', input: ['--labels', 'invalid']},
        {description: 'empty label', input: ['--labels', '']},
        {description: 'missing label value', input: ['--labels']},
    ])('rejects $description before running tests', ({input}) =>
        Effect.gen(function* () {
            const hits = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'invalid-cli-labels',
                    testCases: [{input: 1, expected: 1}],
                    program: (n: number) =>
                        Ref.update(hits, n => n + 1).pipe(Effect.as(n)),
                },
            };
            const error = yield* Effect.flip(
                cliEffect(config, ['node', 'test', 'summarize', ...input]),
            );
            t.expect(error._tag).toBe('ShowHelp');
            t.expect(yield* Ref.get(hits)).toBe(0);
        }),
    );
});
