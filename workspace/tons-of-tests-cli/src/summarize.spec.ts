import * as PT from '@creative-introvert/tons-of-tests';
import * as t from '@effect/vitest';
import {Effect, Option} from 'effect';

import {AppConfig, type AppConfigShape} from './Config.js';
import {_commit} from './commit.js';
import {_sumarize} from './summarize.js';

const mkConfig = (
    name: string,
    program: (n: number) => Effect.Effect<number>,
): AppConfigShape<number, number, number> => ({
    dbPath: ':memory:',
    testSuite: {
        name,
        program,
        testCases: [
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
        ],
    },
});

const add = (n: number) => Effect.succeed(n + 1);

const summarizeAll = (
    config: AppConfigShape<number, number, number>,
    cached: boolean,
) =>
    _sumarize({
        labels: Option.none(),
        orTags: Option.none(),
        andTags: Option.none(),
        cached,
        config,
    });

t.describe('CLI: _sumarize / _commit', () => {
    t.layer(PT.TestRepository.TestRepository.TestLayer)(
        'round-trip and idempotency',
        it => {
            it.effect(
                'run -> commit -> --cached returns identical results',
                () =>
                    Effect.gen(function* () {
                        const config = mkConfig('sum-roundtrip', add);
                        const layer = AppConfig.layer(config);

                        const first = yield* summarizeAll(config, false).pipe(
                            Effect.provide(layer),
                        );
                        yield* _commit({config}).pipe(Effect.provide(layer));
                        const second = yield* summarizeAll(config, false).pipe(
                            Effect.provide(layer),
                        );
                        const cached = yield* summarizeAll(config, true).pipe(
                            Effect.provide(layer),
                        );

                        t.expect(cached.testRun.testCaseHashes).toEqual(
                            second.testRun.testCaseHashes,
                        );
                        t.expect(cached.testRun.stats.TP).toBe(
                            second.testRun.stats.TP,
                        );
                        t.expect(cached.testRun.stats.FP).toBe(
                            second.testRun.stats.FP,
                        );
                        t.expect(cached.testRun.stats.FN).toBe(
                            second.testRun.stats.FN,
                        );
                        t.expect(Option.isSome(second.previousTestRun)).toBe(
                            true,
                        );
                        t.expect(Option.isNone(first.previousTestRun)).toBe(
                            true,
                        );
                    }),
            );

            it.effect('--labels filter does not mutate stored results', () =>
                Effect.gen(function* () {
                    const config = mkConfig('sum-labels-filter', add);
                    const layer = AppConfig.layer(config);
                    const repo = yield* PT.TestRepository.TestRepository;

                    yield* summarizeAll(config, false).pipe(
                        Effect.provide(layer),
                    );
                    const before = yield* repo.getAllTestResults;

                    yield* _sumarize({
                        labels: Option.some(['FP'] as const),
                        orTags: Option.none(),
                        andTags: Option.none(),
                        cached: true,
                        config,
                    }).pipe(Effect.provide(layer));

                    const after = yield* repo.getAllTestResults;
                    // Scope to results that belong to *this* suite — other tests
                    // in the same describe share the DB but not the suite name.
                    const allJunction = yield* repo.getAllTestRunResults;
                    const runs = yield* repo.getAllTestRuns;
                    const myRunIds = new Set(
                        runs
                            .filter(r => r.name === config.testSuite.name)
                            .map(r => r.id),
                    );
                    const myResultIds = new Set(
                        allJunction
                            .filter(j => myRunIds.has(j.testRun))
                            .map(j => j.testResult),
                    );
                    const filterMine = (rows: typeof after) =>
                        rows.filter(r => myResultIds.has(r.id));

                    t.expect(
                        filterMine(after)
                            .map(r => r.id)
                            .sort(),
                    ).toEqual(
                        filterMine(before)
                            .map(r => r.id)
                            .sort(),
                    );
                }),
            );

            it.effect(
                'run -> commit -> run is idempotent (no new testResults rows)',
                () =>
                    Effect.gen(function* () {
                        const config = mkConfig('sum-idempotent', add);
                        const layer = AppConfig.layer(config);
                        const repo = yield* PT.TestRepository.TestRepository;

                        yield* summarizeAll(config, false).pipe(
                            Effect.provide(layer),
                        );
                        yield* _commit({config}).pipe(Effect.provide(layer));

                        // Scope by this suite's run ids, robust to other tests
                        // sharing the same in-memory DB.
                        const runs1 = yield* repo.getAllTestRuns;
                        const junction1 = yield* repo.getAllTestRunResults;
                        const myRunIds1 = new Set(
                            runs1
                                .filter(r => r.name === config.testSuite.name)
                                .map(r => r.id),
                        );
                        const idsAfterCommit = new Set(
                            junction1
                                .filter(j => myRunIds1.has(j.testRun))
                                .map(j => j.testResult),
                        );

                        yield* summarizeAll(config, false).pipe(
                            Effect.provide(layer),
                        );

                        const runs2 = yield* repo.getAllTestRuns;
                        const junction2 = yield* repo.getAllTestRunResults;
                        const myRunIds2 = new Set(
                            runs2
                                .filter(r => r.name === config.testSuite.name)
                                .map(r => r.id),
                        );
                        const idsAfterSecond = new Set(
                            junction2
                                .filter(j => myRunIds2.has(j.testRun))
                                .map(j => j.testResult),
                        );

                        t.expect([...idsAfterSecond].sort()).toEqual(
                            [...idsAfterCommit].sort(),
                        );
                    }),
            );
        },
    );
});
