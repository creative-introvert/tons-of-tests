import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Option, Schema, Stdio, Stream} from 'effect';

import {effectNoDeps} from './index.js';

const config = {
    dbPath: ':memory:',
    testSuite: {
        name: 'commits',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: [],
        variants: {},
    },
};
const services = Layer.mergeAll(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
    Stdio.layerTest({}),
);

it.effect(
    'exact commits keep older runs, allow retired variants, and reject other suites',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const firstAttempt = (yield* repository.withTestRun(
                {name: 'commits', variant: 'retired'},
                () => Effect.void,
            )).run;
            const [first] = yield* repository.commitTestRuns([firstAttempt]);
            const secondAttempt = (yield* repository.withTestRun(
                {name: 'commits', variant: 'retired'},
                () => Effect.void,
            )).run;
            const [second] = yield* repository.commitTestRuns([secondAttempt]);
            const otherAttempt = (yield* repository.withTestRun(
                {name: 'other', variant: 'retired'},
                () => Effect.void,
            )).run;
            const [other] = yield* repository.commitTestRuns([otherAttempt]);
            yield* effectNoDeps(config, [
                'node',
                'suite',
                'commit',
                '--run',
                `run:${first.id}`,
            ]);
            yield* effectNoDeps(config, [
                'node',
                'suite',
                'commit',
                '--run',
                `run:${first.id}`,
            ]);
            const wrongSuite = yield* effectNoDeps(config, [
                'node',
                'suite',
                'commit',
                '--run',
                `run:${other.id}`,
            ]).pipe(Effect.flip);
            expect({
                error: wrongSuite._tag,
                own: Option.map(
                    yield* repository.getBaselineTestRun({
                        name: 'commits',
                        variant: 'retired',
                    }),
                    run => run.id,
                ),
                other: yield* repository.getBaselineTestRun({
                    name: 'other',
                    variant: 'retired',
                }),
                runs: (yield* repository.listTestRuns({
                    name: 'commits',
                    limit: 100,
                })).map(run => [run.id, run.isBaseline]),
            }).toEqual({
                error: 'InvalidCommandOptions',
                own: Option.some(first.id),
                other: Option.some(other),
                runs: [
                    [second.id, false],
                    [first.id, true],
                ],
            });
        }).pipe(Effect.provide(services)),
);

it.effect(
    'commits all complete cached variants without execution or report filters',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            let calls = 0;
            let mayExecute = true;
            const program = (input: number) =>
                Effect.sync(() => {
                    if (!mayExecute) throw new Error('commit must not execute');
                    calls++;
                    return input;
                });
            const selected = {
                ...config,
                testSuite: {
                    ...config.testSuite,
                    testCases: [
                        {input: 1, expected: 1, tags: ['keep']},
                        {input: 2, expected: 2},
                    ],
                    variants: {B: {program}, A: {program}},
                },
            };
            yield* effectNoDeps(selected, [
                'node',
                'suite',
                'summarize',
                '--tags',
                'keep',
            ]);
            mayExecute = false;
            yield* effectNoDeps(selected, ['node', 'suite', 'commit']);
            yield* effectNoDeps(selected, ['node', 'suite', 'commit']);
            yield* effectNoDeps(selected, [
                'node',
                'suite',
                'stats',
                '--cached',
            ]);
            const snapshots = yield* repository.listTestRuns({
                name: 'commits',
                limit: 100,
            });
            const rows = yield* Effect.forEach(snapshots, run =>
                repository
                    .getTestResultsStream(run, selected.testSuite.schemas)
                    .pipe(Stream.runCollect),
            );
            expect({
                calls,
                variants: snapshots.map(run => [
                    run.variant,
                    run.store,
                    run.isBaseline,
                ]),
                inputs: rows.map(results => results.map(row => row.input)),
            }).toEqual({
                calls: 4,
                variants: [
                    ['A', 'snapshot', true],
                    ['B', 'snapshot', true],
                ],
                inputs: [
                    [1, 2],
                    [1, 2],
                ],
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each(['missing', 'failed'] as const)(
    'a %s selected variant leaves every baseline unchanged',
    state =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const selected = {
                ...config,
                testSuite: {
                    ...config.testSuite,
                    variants: {
                        A: {program: (input: number) => Effect.succeed(input)},
                        B: {program: (input: number) => Effect.succeed(input)},
                    },
                },
            };
            yield* effectNoDeps(selected, ['node', 'suite', 'summarize']);
            yield* effectNoDeps(selected, ['node', 'suite', 'commit']);
            const before = yield* repository.listTestRuns({
                name: 'commits',
                limit: 100,
            });
            yield* effectNoDeps(selected, [
                'node',
                'suite',
                'summarize',
                '--variant',
                'A',
            ]);
            const variants =
                state === 'missing'
                    ? {
                          ...selected.testSuite.variants,
                          C: selected.testSuite.variants.B,
                      }
                    : selected.testSuite.variants;
            if (state === 'failed') {
                yield* repository
                    .withTestRun({name: 'commits', variant: 'B'}, () =>
                        Effect.fail('failed'),
                    )
                    .pipe(Effect.result);
            }
            const error = yield* effectNoDeps(
                {...selected, testSuite: {...selected.testSuite, variants}},
                ['node', 'suite', 'commit'],
            ).pipe(Effect.flip);
            expect({
                tag: error._tag,
                snapshots: yield* repository.listTestRuns({
                    name: 'commits',
                    limit: 100,
                }),
            }).toEqual({
                tag:
                    state === 'missing'
                        ? 'TestRunNotCreated'
                        : 'TestRunIncomplete',
                snapshots: before,
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each([
    {args: ['--run', 'run:1', '--variant', 'A'], tag: 'InvalidCommandOptions'},
    {args: ['--run', 'A'], tag: 'ShowHelp'},
    {args: ['--run', 'run:0'], tag: 'ShowHelp'},
    {args: ['--run', 'run:999'], tag: 'TestRunNotFound'},
])('rejects an invalid exact commit ($tag)', ({args, tag}) =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const error = yield* effectNoDeps(config, [
            'node',
            'suite',
            'commit',
            ...args,
        ]).pipe(Effect.flip);
        expect({
            tag: error._tag,
            runs: yield* repository.listTestRuns({name: 'commits', limit: 100}),
        }).toEqual({tag, runs: []});
    }).pipe(Effect.provide(services)),
);
