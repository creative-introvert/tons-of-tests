import {NodeServices} from '@effect/platform-node';
import * as PT from '@creative-introvert/tons-of-tests';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Option, Ref, Schema, Stream} from 'effect';

import {getAllTestResults} from '../../tons-of-tests/src/internal/test-repository-fixtures.js';
import {_commit} from './commit.js';
import {prepareReport} from './test-run.js';

const services = Layer.merge(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
);
const config = {
    dbPath: ':memory:',
    testSuite: {
        name: 'summary',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: [
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
        ],
        program: (input: number) => Effect.succeed(input + 1),
    },
};

it.effect(
    'run, commit, and cached summary retain the results and baseline',
    () =>
        Effect.gen(function* () {
            const first = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            yield* _commit({config});
            const second = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            const cached = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: true,
            });
            expect({
                counts: [first.count, second.count, cached.count],
                cachedStats: cached.stats,
                firstBaseline: first.previousStats,
                nextBaseline: second.previousStats,
                cachedOutput: yield* cached.chunks.pipe(Stream.runCollect),
            }).toEqual({
                counts: [3, 3, 3],
                cachedStats: second.stats,
                firstBaseline: Option.none(),
                nextBaseline: Option.some(first.stats),
                cachedOutput: yield* second.chunks.pipe(Stream.runCollect),
            });
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('label filters leave stored results intact', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const {run} = yield* prepareReport({
            mode: 'summarize',
            config,
            cached: false,
        });
        const before = yield* repository
            .getTestResultsStream(run, config.testSuite.schemas)
            .pipe(Stream.runCollect);
        const filtered = yield* prepareReport({
            mode: 'summarize',
            config,
            cached: true,
            labels: Option.some(['FP']),
        });
        expect({
            visible: filtered.count,
            saved: yield* repository
                .getTestResultsStream(run, config.testSuite.schemas)
                .pipe(Stream.runCollect),
        }).toEqual({visible: 0, saved: before});
    }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('filters grouped results while keeping the full cache', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const hits = yield* Ref.make(0);
        const expected = {budget: 100, need: 2};
        const classify = PT.Classify.makeClassify({
            isEqual: Schema.toEquivalence(Schema.Finite),
        });
        const grouped = {
            dbPath: ':memory:',
            testSuite: {
                name: 'grouped-summary',
                testCases: [
                    {input: 'call-1', expected, tags: ['enterprise', 'de']},
                    {input: 'call-2', expected, tags: ['smb', 'de']},
                ],
                program: (_: string) =>
                    Ref.update(hits, n => n + 1).pipe(
                        Effect.as({budget: 80, need: 2}),
                    ),
                evaluate: (result: typeof expected, target: typeof expected) =>
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
            },
        };
        const filtered = yield* prepareReport({
            mode: 'summarize',
            config: grouped,
            cached: false,
            keys: Option.some(['budget']),
            labels: Option.some(['FP']),
            orTags: Option.some(['enterprise', 'missing']),
            andTags: Option.some(['enterprise', 'de']),
        });
        const cached = yield* prepareReport({
            mode: 'summarize',
            config: grouped,
            cached: true,
        });
        const empty = yield* prepareReport({
            mode: 'summarize',
            config: grouped,
            cached: true,
            keys: Option.some(['missing']),
        });
        const run = cached.run;
        const saved = yield* repository
            .getTestResultsStream(run, grouped.testSuite.schemas)
            .pipe(Stream.runCollect);
        expect({
            calls: yield* Ref.get(hits),
            visible: {
                count: filtered.count,
                cases: filtered.stats.testCases,
                TP: filtered.stats.TP,
                FP: filtered.stats.FP,
            },
            saved: saved.map(row => [
                row.input,
                row.key,
                row.result,
                row.expected,
                row.label,
            ]),
            cached: {count: cached.count, cases: cached.stats.testCases},
            empty: {
                count: empty.count,
                cases: empty.stats.testCases,
                timeMean: empty.stats.timeMean,
            },
        }).toEqual({
            calls: 2,
            visible: {count: 1, cases: 1, TP: 0, FP: 1},
            saved: [
                ['call-1', 'budget', 80, 100, 'FP'],
                ['call-1', 'need', 2, 2, 'TP'],
                ['call-2', 'budget', 80, 100, 'FP'],
                ['call-2', 'need', 2, 2, 'TP'],
            ],
            cached: {count: 4, cases: 2},
            empty: {count: 0, cases: 0, timeMean: Option.none()},
        });
    }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('running again after a commit reuses unchanged saved results', () =>
    Effect.gen(function* () {
        yield* prepareReport({mode: 'summarize', config, cached: false});
        yield* _commit({config});
        const before = yield* getAllTestResults;
        yield* prepareReport({mode: 'summarize', config, cached: false});
        expect(yield* getAllTestResults).toEqual(before);
    }).pipe(Effect.scoped, Effect.provide(services)),
);
