import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import * as t from '@effect/vitest';
import colors from 'ansi-colors';
import {Effect, Layer, Option, Ref, Schema} from 'effect';

import type {AppConfigShape} from './Config.js';
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
    t.layer(
        Layer.merge(
            PT.TestRepository.TestRepository.TestLayer,
            NodeServices.layer,
        ),
    )('round-trip and idempotency', it => {
        it.effect('run -> commit -> --cached returns identical results', () =>
            Effect.gen(function* () {
                const config = mkConfig('sum-roundtrip', add);

                const first = yield* summarizeAll(config, false);
                yield* _commit({config});
                const second = yield* summarizeAll(config, false);
                const cached = yield* summarizeAll(config, true);

                t.expect(cached.testRun.testCaseHashes).toEqual(
                    second.testRun.testCaseHashes,
                );
                t.expect(cached.testRun.stats.TP).toBe(second.testRun.stats.TP);
                t.expect(cached.testRun.stats.FP).toBe(second.testRun.stats.FP);
                t.expect(cached.testRun.stats.FN).toBe(second.testRun.stats.FN);
                t.expect(Option.isSome(second.previousTestRun)).toBe(true);
                t.expect(Option.isNone(first.previousTestRun)).toBe(true);
            }),
        );

        it.effect('--labels filter does not mutate stored results', () =>
            Effect.gen(function* () {
                const config = mkConfig('sum-labels-filter', add);

                const repo = yield* PT.TestRepository.TestRepository;

                yield* summarizeAll(config, false);
                const before = yield* repo.getAllTestResults;

                yield* _sumarize({
                    labels: Option.some(['FP'] as const),
                    orTags: Option.none(),
                    andTags: Option.none(),
                    cached: true,
                    config,
                });

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
            'filters grouped outcomes while keeping all outcomes in the cache',
            () =>
                Effect.gen(function* () {
                    const hits = yield* Ref.make(0);
                    const expected = {budget: 100, need: 2};
                    const classify = PT.Classify.makeClassify({
                        isEqual: PT.Classify.defaultIsEqual,
                    });
                    const config = {
                        dbPath: ':memory:',
                        testSuite: {
                            name: 'sum-grouped-outcomes',
                            testCases: [
                                {
                                    input: 'call-1',
                                    expected,
                                    tags: ['enterprise', 'de'],
                                },
                                {
                                    input: 'call-2',
                                    expected,
                                    tags: ['smb', 'de'],
                                },
                            ],
                            program: (_: string) =>
                                Ref.update(hits, n => n + 1).pipe(
                                    Effect.as({budget: 80, need: 2}),
                                ),
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
                            schemas: {
                                input: Schema.String,
                                result: Schema.Finite,
                                expected: Schema.Finite,
                            },
                        },
                    };

                    const filtered = yield* _sumarize({
                        config,
                        cached: false,
                        keys: Option.some(['budget']),
                        labels: Option.some(['FP']),
                        orTags: Option.some(['enterprise', 'missing']),
                        andTags: Option.some(['enterprise', 'de']),
                    });
                    const cached = yield* _sumarize({config, cached: true});
                    const empty = yield* _sumarize({
                        config,
                        cached: true,
                        keys: Option.some(['missing']),
                    });
                    const rows = cached.testRun.testResultKeys.map(
                        key => cached.testRun.testResultsByKey[key],
                    );

                    t.expect({
                        hits: yield* Ref.get(hits),
                        filteredRows: filtered.testRun.testResultKeys.map(
                            key => {
                                const row =
                                    filtered.testRun.testResultsByKey[key];
                                return {
                                    input: row.input,
                                    key: row.key,
                                    result: row.result,
                                    expected: row.expected,
                                };
                            },
                        ),
                        filteredStats: {
                            total: filtered.testRun.stats.total,
                            cases: filtered.testRun.stats.testCases,
                            TP: filtered.testRun.stats.TP,
                            FP: filtered.testRun.stats.FP,
                        },
                        cachedRows: rows.map(row => [
                            row.input,
                            row.key,
                            row.label,
                        ]),
                        cachedStats: {
                            total: cached.testRun.stats.total,
                            cases: cached.testRun.stats.testCases,
                        },
                        emptyStats: {
                            total: empty.testRun.stats.total,
                            cases: empty.testRun.stats.testCases,
                            timeMean: empty.testRun.stats.timeMean,
                        },
                    }).toEqual({
                        hits: 2,
                        filteredRows: [
                            {
                                input: 'call-1',
                                key: 'budget',
                                result: 80,
                                expected: 100,
                            },
                        ],
                        filteredStats: {total: 1, cases: 1, TP: 0, FP: 1},
                        cachedRows: [
                            ['call-1', 'budget', 'FP'],
                            ['call-1', 'need', 'TP'],
                            ['call-2', 'budget', 'FP'],
                            ['call-2', 'need', 'TP'],
                        ],
                        cachedStats: {total: 4, cases: 2},
                        emptyStats: {
                            total: 0,
                            cases: 0,
                            timeMean: Option.none(),
                        },
                    });
                    t.expect(rows.map(row => row.hashTestCase)).toEqual([
                        cached.testRun.testCaseHashes[0],
                        cached.testRun.testCaseHashes[0],
                        cached.testRun.testCaseHashes[1],
                        cached.testRun.testCaseHashes[1],
                    ]);
                    const tableRows = colors
                        .unstyle(
                            PT.Show.summarize({
                                testRun: cached.testRun,
                                selectColumns: ['hash', 'key'],
                            }),
                        )
                        .split('\n')
                        .map(line =>
                            line
                                .split('│')
                                .slice(1, -1)
                                .map(cell => cell.trim()),
                        )
                        .filter(
                            cells =>
                                cells[1] === 'budget' || cells[1] === 'need',
                        );
                    t.expect(tableRows).toEqual([
                        [
                            cached.testRun.testCaseHashes[0].slice(0, 8),
                            'budget',
                        ],
                        [cached.testRun.testCaseHashes[0].slice(0, 8), 'need'],
                        [
                            cached.testRun.testCaseHashes[1].slice(0, 8),
                            'budget',
                        ],
                        [cached.testRun.testCaseHashes[1].slice(0, 8), 'need'],
                    ]);
                }),
        );

        it.effect(
            'run -> commit -> run is idempotent (no new testResults rows)',
            () =>
                Effect.gen(function* () {
                    const config = mkConfig('sum-idempotent', add);

                    const repo = yield* PT.TestRepository.TestRepository;

                    yield* summarizeAll(config, false);
                    yield* _commit({config});

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

                    yield* summarizeAll(config, false);

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
    });
});
