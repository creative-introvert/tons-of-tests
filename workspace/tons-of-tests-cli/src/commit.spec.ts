import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Option, Schema, Stdio} from 'effect';

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
            const first = (yield* repository.withTestRun(
                {name: 'commits', variant: 'retired'},
                () => Effect.void,
            )).run;
            const second = (yield* repository.withTestRun(
                {name: 'commits', variant: 'retired'},
                () => Effect.void,
            )).run;
            const other = (yield* repository.withTestRun(
                {name: 'other', variant: 'retired'},
                () => Effect.void,
            )).run;
            yield* repository.commitTestRun(second.id);
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
                other: Option.none(),
                runs: [
                    [second.id, false],
                    [first.id, true],
                ],
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
