import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {Effect, Layer, Schema, Sink, Stdio} from 'effect';

import {effectNoDeps} from './index.js';

const config = {
    dbPath: ':memory:',
    testSuite: {
        name: 'history',
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

it.effect('lists descending pages without gaps and marks each baseline', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const saved = yield* Effect.forEach(
            Array.from({length: 57}, (_, index) => index),
            index =>
                Effect.gen(function* () {
                    const {run} = yield* repository.withTestRun(
                        {name: 'history', variant: index % 2 === 0 ? 'A' : 'B'},
                        () => Effect.void,
                    );
                    const [snapshot] = yield* repository.commitTestRuns([run]);
                    return snapshot;
                }),
        );
        yield* repository.commitTestRuns([saved[4], saved[55]]);
        yield* repository.withTestRun(
            {name: 'history', variant: 'A'},
            () => Effect.void,
        );
        const lines: string[] = [];
        const capture = Stdio.layerTest({
            stdout: () =>
                Sink.forEach(chunk =>
                    Effect.sync(() => {
                        lines.push(String(chunk));
                    }),
                ),
        });
        yield* effectNoDeps(config, ['node', 'suite', 'runs']).pipe(
            Effect.provide(capture),
        );
        const first = lines
            .join('')
            .split('\n')
            .filter(line => line.startsWith('run:'))
            .map(line => line.split('\t'));
        lines.length = 0;
        yield* effectNoDeps(config, [
            'node',
            'suite',
            'runs',
            '--before',
            first[first.length - 1][0].slice(4),
        ]).pipe(Effect.provide(capture));
        const second = lines
            .join('')
            .split('\n')
            .filter(line => line.startsWith('run:'))
            .map(line => line.split('\t'));
        const all = [...first, ...second];
        expect({
            pageSizes: [first.length, second.length],
            ids: all.map(row => Number(row[0].slice(4))),
            baselines: all
                .filter(row => row[3] === 'yes')
                .map(row => Number(row[0].slice(4))),
        }).toEqual({
            pageSizes: [50, 7],
            ids: saved.map(run => run.id).reverse(),
            baselines: [saved[55].id, saved[4].id],
        });
        lines.length = 0;
        yield* effectNoDeps(config, [
            'node',
            'suite',
            'runs',
            '--variant',
            'A',
            '--limit',
            '3',
        ]).pipe(Effect.provide(capture));
        const filtered = lines
            .join('')
            .split('\n')
            .filter(line => line.startsWith('run:'))
            .map(line => line.split('\t'));
        expect(filtered.map(row => [row[0], row[1], row[2]])).toEqual(
            saved
                .filter(run => run.variant === 'A')
                .slice(-3)
                .reverse()
                .map(run => [`run:${run.id}`, 'A', 'Complete']),
        );
    }).pipe(Effect.provide(services)),
);

it.effect.each(['0', '101', '-1', '1.5'])('rejects --limit %s', limit =>
    Effect.gen(function* () {
        const error = yield* effectNoDeps(config, [
            'node',
            'suite',
            'runs',
            '--limit',
            limit,
        ]).pipe(Effect.flip);
        expect(error._tag).toBe('ShowHelp');
    }).pipe(Effect.provide(services)),
);
