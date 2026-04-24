import * as PT from '@creative-introvert/tons-of-tests';
import * as t from '@effect/vitest';
import {Cause, Effect, Exit, Option} from 'effect';

import {_commit} from './commit.js';
import {AppConfig, type AppConfigShape} from './Config.js';
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
const addOneExceptFor2 = (n: number) =>
    Effect.succeed(n === 1 ? n + 2 : n + 1);

t.describe('CLI: _diff', () => {
    t.layer(PT.TestRepository.TestRepository.TestLayer)('with shared db', it => {
        it.effect('no previous run -> returns all cases', () =>
            Effect.gen(function* () {
                const config = mkConfig('diff-no-previous', add);
                const {testRun, previousTestRun} = yield* _diff({
                    cached: false,
                    config,
                }).pipe(Effect.provide(AppConfig.layer(config)));
                t.expect(Option.isNone(previousTestRun)).toBe(true);
                t.expect(testRun.testCaseHashes).toHaveLength(2);
            }),
        );

        it.effect('after commit with unchanged program -> empty testCaseHashes', () =>
            Effect.gen(function* () {
                const config = mkConfig('diff-unchanged', add);
                const layer = AppConfig.layer(config);

                yield* _sumarize({
                    labels: Option.none(),
                    orTags: Option.none(),
                    andTags: Option.none(),
                    cached: false,
                    config,
                }).pipe(Effect.provide(layer));
                yield* _commit({config}).pipe(Effect.provide(layer));

                const {testRun} = yield* _diff({cached: false, config}).pipe(
                    Effect.provide(layer),
                );
                t.expect(testRun.testCaseHashes).toEqual([]);
            }),
        );

        it.effect('after commit with fully-changed program -> both entries surface', () =>
            Effect.gen(function* () {
                const baseConfig = mkConfig('diff-both-changed', add);
                const changedConfig = mkConfig('diff-both-changed', addTwo);

                yield* _sumarize({
                    labels: Option.none(),
                    orTags: Option.none(),
                    andTags: Option.none(),
                    cached: false,
                    config: baseConfig,
                }).pipe(Effect.provide(AppConfig.layer(baseConfig)));
                yield* _commit({config: baseConfig}).pipe(
                    Effect.provide(AppConfig.layer(baseConfig)),
                );

                const {testRun} = yield* _diff({
                    cached: false,
                    config: changedConfig,
                }).pipe(Effect.provide(AppConfig.layer(changedConfig)));
                t.expect(testRun.testCaseHashes).toHaveLength(2);
            }),
        );

        // Discriminating case: only one input's output changes. A
        // `filterUnchanged` regression (sign flip, pass-through, or
        // "always include") would not exhibit length=1 AND the right hash.
        it.effect('diff --exit-on-diff fails with DiffNonEmpty on non-empty diff', () =>
            Effect.gen(function* () {
                const baseConfig = mkConfig('diff-exit-on-diff', add);
                const changedConfig = mkConfig('diff-exit-on-diff', addTwo);

                yield* _sumarize({
                    labels: Option.none(),
                    orTags: Option.none(),
                    andTags: Option.none(),
                    cached: false,
                    config: baseConfig,
                }).pipe(Effect.provide(AppConfig.layer(baseConfig)));
                yield* _commit({config: baseConfig}).pipe(
                    Effect.provide(AppConfig.layer(baseConfig)),
                );

                const exit = yield* diffCommand
                    .handler({exitOnDiff: true, cached: false})
                    .pipe(
                        Effect.provide(AppConfig.layer(changedConfig)),
                        Effect.exit,
                    );

                t.expect(Exit.isFailure(exit)).toBe(true);
                const err = Exit.isFailure(exit)
                    ? Option.getOrNull(Cause.failureOption(exit.cause))
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
                }).pipe(Effect.provide(AppConfig.layer(config)));
                yield* _commit({config}).pipe(
                    Effect.provide(AppConfig.layer(config)),
                );

                const exit = yield* diffCommand
                    .handler({exitOnDiff: true, cached: false})
                    .pipe(
                        Effect.provide(AppConfig.layer(config)),
                        Effect.exit,
                    );

                t.expect(Exit.isSuccess(exit)).toBe(true);
            }),
        );

        it.effect('after commit with single-input change -> exactly that entry surfaces', () =>
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
                }).pipe(Effect.provide(AppConfig.layer(baseConfig)));
                yield* _commit({config: baseConfig}).pipe(
                    Effect.provide(AppConfig.layer(baseConfig)),
                );

                const {testRun} = yield* _diff({
                    cached: false,
                    config: changedConfig,
                }).pipe(Effect.provide(AppConfig.layer(changedConfig)));

                t.expect(testRun.testCaseHashes).toHaveLength(1);
                // hashTestCase is derived from {input, expected} only.
                const expectedHash = PT.Test.makeSha256({input: 1, expected: 2});
                t.expect(testRun.testCaseHashes[0]).toBe(expectedHash);
                const survivor =
                    testRun.testResultsByTestCaseHash[expectedHash];
                t.expect(survivor?.result).toBe(3);
            }),
        );
    });
});
