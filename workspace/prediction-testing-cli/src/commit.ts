import {randomUUID} from 'node:crypto';

import {Command} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';
import {Config} from './Config.js';

export const _commit = <I = unknown, O = unknown, T = unknown>({
    config: {testSuite},
}: {
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* repository.commitCurrentTestRun({
            name: testSuite.name,
            hash: randomUUID(),
        });
        yield* P.Console.log(`Commited test run.`);
    });

export const commit = Command.make('commit', {}, () =>
    P.Effect.gen(function* () {
        const config = yield* Config;
        yield* _commit({config});
    }),
);
