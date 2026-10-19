import {Command} from 'effect/cli';
import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import * as t from '@effect/vitest';
import {Cause, Effect, Exit, Layer, Option} from 'effect';

import {_commit} from './commit.js';
import type {AppConfigShape} from './Config.js';
import {DiffNonEmpty, _diff, diff as diffCommand} from './diff.js';
import {_sumarize} from './summarize.js';

const mkConfig = (
    name: string,
    program: (n: number) => Effect.Effect<number>,
    testCases: ReadonlyArray<{input: number; expected: number}> = [
        {input: 1, expected: 2},
        {input: 2, expected: 3},
    ],
): AppConfigShape<number, number, number> => ({
    dbPath: ':memory:',
    testSuite: {name, program, testCases: [...testCases]},
});

const add = (n: number) => Effect.succeed(n + 1);
const addTwo = (n: number) => Effect.succeed(n + 2);
// Changes output for input=1 only; input=2 still maps to 3.
const addOneExceptFor2 = (n: number) => Effect.succeed(n === 1 ? n + 2 : n + 1);

t.describe('CLI: _diff', () => {
    t.layer(
        Layer.merge(
            PT.TestRepository.TestRepository.TestLayer,
            NodeServices.layer,
        ),
    )('with shared db', it => {
        it.effect('no previous run -> returns all cases', () =>
            Effect.gen(function* () {
                const config = mkConfig('diff-no-previous', add);
                const {testRun, previousTestRun} = yield* _diff({
                    cached: false,
                    config,
                });
                t.expect(Option.isNone(previousTestRun)).toBe(true);
                t.expect(testRun.testCaseHashes).toHaveLength(2);
            }),
        );

        it.effect(
            'after commit with unchanged program -> empty testCaseHashes',
            () =>
                Effect.gen(function* () {
                    const config = mkConfig('diff-unchanged', add);

                    yield* _sumarize({
                        labels: Option.none(),
                        orTags: Option.none(),
                        andTags: Option.none(),
                        cached: false,
                        config,
                    });
                    yield* _commit({config});

                    const {testRun} = yield* _diff({
                        cached: false,
                        config,
                    });
                    t.expect(testRun.testCaseHashes).toEqual([]);
                }),
        );

        it.effect(
            'after commit with fully-changed program -> both entries surface',
            () =>
                Effect.gen(function* () {
                    const baseConfig = mkConfig('diff-both-changed', add);
                    const changedConfig = mkConfig('diff-both-changed', addTwo);

                    yield* _sumarize({
                        labels: Option.none(),
                        orTags: Option.none(),
                        andTags: Option.none(),
                        cached: false,
                        config: baseConfig,
                    });
                    yield* _commit({config: baseConfig});

                    const {testRun} = yield* _diff({
                        cached: false,
                        config: changedConfig,
                    });
                    t.expect(testRun.testCaseHashes).toHaveLength(2);
                }),
        );

        // Discriminating case: only one input's output changes. A
        // `filterUnchanged` regression (sign flip, pass-through, or
        // "always include") would not exhibit length=1 AND the right hash.
        it.effect(
            'diff --exit-on-diff fails with DiffNonEmpty on non-empty diff',
            () =>
                Effect.gen(function* () {
                    const baseConfig = mkConfig('diff-exit-on-diff', add);
                    const changedConfig = mkConfig('diff-exit-on-diff', addTwo);

                    yield* _sumarize({
                        labels: Option.none(),
                        orTags: Option.none(),
                        andTags: Option.none(),
                        cached: false,
                        config: baseConfig,
                    });
                    yield* _commit({config: baseConfig});

                    const exit = yield* Command.runWith(
                        diffCommand(changedConfig),
                        {version: 'test', renderErrors: false},
                    )(['--exit-on-diff']).pipe(Effect.exit);

                    t.expect(Exit.isFailure(exit)).toBe(true);
                    const err = Exit.isFailure(exit)
                        ? Option.getOrNull(Cause.findErrorOption(exit.cause))
                        : null;
                    t.expect(err).toBeInstanceOf(DiffNonEmpty);
                }),
        );

        it.effect('diff --exit-on-diff succeeds on empty diff', () =>
            Effect.gen(function* () {
                const config = mkConfig('diff-exit-on-diff-empty', add);

                yield* _sumarize({
                    labels: Option.none(),
                    orTags: Option.none(),
                    andTags: Option.none(),
                    cached: false,
                    config,
                });
                yield* _commit({config});

                const exit = yield* Command.runWith(diffCommand(config), {
                    version: 'test',
                    renderErrors: false,
                })(['--exit-on-diff']).pipe(Effect.exit);

                t.expect(Exit.isSuccess(exit)).toBe(true);
            }),
        );

        it.effect(
            'after commit with single-input change -> exactly that entry surfaces',
            () =>
                Effect.gen(function* () {
                    const baseConfig = mkConfig('diff-one-changed', add);
                    const changedConfig = mkConfig(
                        'diff-one-changed',
                        addOneExceptFor2,
                    );

                    yield* _sumarize({
                        labels: Option.none(),
                        orTags: Option.none(),
                        andTags: Option.none(),
                        cached: false,
                        config: baseConfig,
                    });
                    yield* _commit({config: baseConfig});

                    const {testRun} = yield* _diff({
                        cached: false,
                        config: changedConfig,
                    });

                    t.expect(testRun.testCaseHashes).toHaveLength(1);
                    // hashTestCase is derived from {input, expected} only.
                    const expectedHash = PT.Test.makeSha256({
                        input: 1,
                        expected: 2,
                    });
                    t.expect(testRun.testCaseHashes[0]).toBe(expectedHash);
                    const survivor =
                        testRun.testResultsByKey[
                            PT.Test.resultKey({
                                hashTestCase: expectedHash,
                                key: 'result',
                            })
                        ];
                    t.expect(survivor?.result).toBe(3);
                }),
        );

        it.effect(
            'shows a changed evaluation target even when the result and label stay the same',
            () =>
                Effect.gen(function* () {
                    const baseConfig = {
                        dbPath: ':memory:',
                        testSuite: {
                            name: 'diff-evaluation-target',
                            testCases: [{input: 1, expected: 5}],
                            program: add,
                            evaluate: (result: number, expected: number) =>
                                [
                                    {
                                        key: 'budget',
                                        result,
                                        expected,
                                        label: 'FP',
                                    },
                                ] as const,
                        },
                    };
                    yield* _sumarize({config: baseConfig, cached: false});
                    yield* _commit({config: baseConfig});

                    const config = {
                        ...baseConfig,
                        testSuite: {
                            ...baseConfig.testSuite,
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
                    const {testRun, previousTestRun} = yield* _diff({
                        config,
                        cached: false,
                    });
                    const previous = Option.getOrThrow(previousTestRun);
                    const key = testRun.testResultKeys[0];
                    t.expect(testRun.testResultKeys).toHaveLength(1);
                    t.expect(testRun.testResultsByKey[key]).toMatchObject({
                        key: 'budget',
                        result: 2,
                        expected: 10,
                        label: 'FP',
                    });
                    t.expect(previous.testResultsByKey[key]).toMatchObject({
                        key: 'budget',
                        result: 2,
                        expected: 5,
                        label: 'FP',
                    });
                }),
        );

        it.effect(
            'matches the same outcome before filtering labels and keeps the full cache',
            () =>
                Effect.gen(function* () {
                    const expected = {budget: 100, need: 2};
                    const classify = PT.Classify.makeClassify({
                        isEqual: PT.Classify.defaultIsEqual,
                    });
                    const baseConfig = {
                        dbPath: ':memory:',
                        testSuite: {
                            name: 'diff-grouped-outcomes',
                            testCases: [
                                {
                                    input: 'call-1',
                                    expected,
                                    tags: ['enterprise', 'de'],
                                },
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
                                        label: classify(
                                            result.budget,
                                            target.budget,
                                        ),
                                    },
                                    {
                                        key: 'need',
                                        result: result.need,
                                        expected: target.need,
                                        label: classify(
                                            result.need,
                                            target.need,
                                        ),
                                    },
                                ] as const,
                        },
                    };
                    const changedConfig = {
                        ...baseConfig,
                        testSuite: {
                            ...baseConfig.testSuite,
                            program: (_: string) =>
                                Effect.succeed({budget: 80, need: 2}),
                        },
                    };

                    yield* _sumarize({config: baseConfig, cached: false});
                    yield* _commit({config: baseConfig});

                    const view = yield* _diff({
                        config: changedConfig,
                        cached: false,
                        keys: Option.some(['budget']),
                        labels: Option.some(['FP']),
                        orTags: Option.some(['enterprise']),
                        andTags: Option.some(['enterprise', 'de']),
                    });
                    const previous = Option.getOrThrow(view.previousTestRun);
                    const cached = yield* _sumarize({
                        config: changedConfig,
                        cached: true,
                    });

                    t.expect({
                        current: view.testRun.testResultKeys.map(
                            key => view.testRun.testResultsByKey[key].key,
                        ),
                        prior: previous.testResultKeys.map(key => {
                            const row = previous.testResultsByKey[key];
                            return {
                                key: row.key,
                                label: row.label,
                                result: row.result,
                            };
                        }),
                        diff: PT.Test.diff(view),
                        cached: cached.testRun.testResultKeys.map(
                            key => cached.testRun.testResultsByKey[key].key,
                        ),
                    }).toEqual({
                        current: ['budget'],
                        prior: [{key: 'budget', label: 'TP', result: 100}],
                        diff: {
                            TP: -1,
                            TN: 0,
                            FP: 1,
                            FN: 0,
                            precision: -1,
                            recall: -1,
                        },
                        cached: ['budget', 'need'],
                    });

                    const cachedDiff = yield* _diff({
                        config: changedConfig,
                        cached: true,
                        keys: Option.some(['budget']),
                        labels: Option.some(['FP']),
                    });
                    t.expect(cachedDiff).toEqual(view);

                    const budgetOnly = {
                        ...changedConfig,
                        testSuite: {
                            ...changedConfig.testSuite,
                            evaluate: (
                                result: typeof expected,
                                target: typeof expected,
                            ) =>
                                [
                                    changedConfig.testSuite.evaluate(
                                        result,
                                        target,
                                    )[0],
                                ] as const,
                        },
                    };
                    yield* _diff({config: budgetOnly, cached: false});
                    const replacedCache = yield* _sumarize({
                        config: budgetOnly,
                        cached: true,
                    });
                    t.expect(
                        replacedCache.testRun.testResultKeys.map(
                            key =>
                                replacedCache.testRun.testResultsByKey[key].key,
                        ),
                    ).toEqual(['budget']);
                }),
        );
    });
});
