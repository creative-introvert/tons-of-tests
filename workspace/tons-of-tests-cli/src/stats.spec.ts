import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Option, Schema, Sink, Stdio} from 'effect';
import {SqlClient} from 'effect/sql';

import {effectNoDeps} from './index.js';
import {summarizeRuns} from './stats.js';

const schemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};
const services = Layer.mergeAll(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
    Stdio.layerTest({}),
);

it.effect(
    'shows configured baselines, retired history, and missing or empty baselines',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            let calls = 0;
            const program = (input: number) =>
                Effect.sync(() => {
                    calls++;
                    return input;
                });
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'overview',
                    schemas,
                    testCases: [{input: 1, expected: 1}],
                    variants: {A: {program}, B: {program}, C: {program}},
                },
            };
            for (const variant of ['A', 'C', 'A', 'B', 'C', 'A', 'B']) {
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
            }
            const empty = yield* repository.withTestRun(
                {name: 'overview', variant: 'empty'},
                () => Effect.void,
            );
            yield* repository.commitTestRun(empty.run.id);
            const retired = {
                ...config,
                testSuite: {
                    ...config.testSuite,
                    variants: {
                        B: {program},
                        A: {program},
                        missing: {program},
                        empty: {program},
                    },
                },
            };
            const before = yield* repository.listTestRuns({
                name: 'overview',
                limit: 100,
            });
            const rows = yield* summarizeRuns({config: retired});
            const output: string[] = [];
            yield* effectNoDeps(retired, ['node', 'suite', 'stats']).pipe(
                Effect.provide(
                    Stdio.layerTest({
                        stdout: () =>
                            Sink.forEach(chunk =>
                                Effect.sync(() => {
                                    output.push(String(chunk));
                                }),
                            ),
                    }),
                ),
            );
            expect(
                rows.map(row => ({
                    variant: row.variant,
                    retired: row.retired,
                    id: Option.map(row.run, run => run.id),
                    count: Option.map(row.stats, stats => stats.total),
                })),
            ).toEqual([
                {
                    variant: 'B',
                    retired: false,
                    id: Option.some(before[1].id),
                    count: Option.some(1),
                },
                {
                    variant: 'A',
                    retired: false,
                    id: Option.some(before[2].id),
                    count: Option.some(1),
                },
                {
                    variant: 'missing',
                    retired: false,
                    id: Option.none(),
                    count: Option.none(),
                },
                {
                    variant: 'empty',
                    retired: false,
                    id: Option.some(empty.run.id),
                    count: Option.some(0),
                },
                {
                    variant: 'C',
                    retired: true,
                    id: Option.some(before[3].id),
                    count: Option.some(1),
                },
            ]);
            expect(output.join('')).toContain('retired');
            expect(output.join('')).toContain('missing');
            expect({
                calls,
                saved: yield* repository.listTestRuns({
                    name: 'overview',
                    limit: 100,
                }),
            }).toEqual({calls: 7, saved: before});
        }).pipe(Effect.provide(services)),
);

it.effect(
    'explicit runs preserve order, use independent filters, and allow other suites',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            let calls = 0;
            const program = (input: number) =>
                Effect.sync(() => {
                    calls++;
                    return input;
                });
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'selected',
                    schemas,
                    testCases: [
                        {input: 1, expected: 1, tags: ['keep']},
                        {input: 2, expected: 2},
                    ],
                    program,
                },
            };
            yield* effectNoDeps(config, ['node', 'suite', 'summarize']);
            yield* effectNoDeps(config, ['node', 'suite', 'commit']);
            const first = Option.getOrThrow(
                yield* repository.getBaselineTestRun({
                    name: 'selected',
                    variant: 'default',
                }),
            );
            const otherConfig = {
                ...config,
                testSuite: {
                    ...config.testSuite,
                    name: 'other',
                    testCases: [
                        {input: 9, expected: 9, tags: ['keep']},
                        {input: 10, expected: 10, tags: ['keep']},
                    ],
                },
            };
            yield* effectNoDeps(otherConfig, ['node', 'suite', 'summarize']);
            const other = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'other',
                    variant: 'default',
                }),
            );
            const snapshots = yield* Effect.all([
                repository.listTestRuns({name: 'selected', limit: 100}),
                repository.listTestRuns({name: 'other', limit: 100}),
            ]);
            const rows = yield* summarizeRuns({
                config,
                references: [
                    {_tag: 'Run', id: other.id},
                    {_tag: 'Baseline', variant: 'default'},
                    {_tag: 'Run', id: other.id},
                ],
                orTags: Option.some(['keep']),
            });
            expect(
                rows.map(row => [
                    row.name,
                    Option.map(row.run, run => run.id),
                    Option.map(row.stats, stats => [
                        stats.testCases,
                        stats.total,
                    ]),
                ]),
            ).toEqual([
                ['other', Option.some(other.id), Option.some([2, 2])],
                ['selected', Option.some(first.id), Option.some([1, 1])],
                ['other', Option.some(other.id), Option.some([2, 2])],
            ]);
            yield* effectNoDeps(config, [
                'node',
                'suite',
                'stats',
                '--runs',
                `run:${other.id},default,run:${other.id}`,
                '--tags',
                'keep',
            ]);
            const sql = yield* SqlClient.SqlClient;
            expect({
                calls,
                snapshots: yield* Effect.all([
                    repository.listTestRuns({name: 'selected', limit: 100}),
                    repository.listTestRuns({name: 'other', limit: 100}),
                ]),
                tables: yield* sql`SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name LIKE 'tots_stats_%';`,
            }).toEqual({calls: 4, snapshots, tables: []});
        }).pipe(Effect.provide(services)),
);

it.effect.each([
    {reference: 'missing', expected: 'TestBaselineNotFound'},
    {reference: 'run:999', expected: 'TestRunNotFound'},
    {reference: '', expected: 'ShowHelp'},
    {reference: 'A,,B', expected: 'ShowHelp'},
    {reference: 'run:-1', expected: 'ShowHelp'},
    {reference: 'run:1.2', expected: 'ShowHelp'},
])(
    'stats refuses $reference without executing a program',
    ({reference, expected}) =>
        Effect.gen(function* () {
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'invalid',
                    schemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            const error = yield* effectNoDeps(config, [
                'node',
                'suite',
                'stats',
                '--runs',
                reference,
            ]).pipe(Effect.flip);
            expect({tag: error._tag, calls}).toEqual({tag: expected, calls: 0});
        }).pipe(Effect.provide(services)),
);
