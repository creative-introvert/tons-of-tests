import {randomUUID} from 'node:crypto';

import {Command} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

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
        yield* repository.clearStale({name: testSuite.name});
        yield* P.Console.log(`Commited test run and cleared stale.`);
    });

export const commit = Command.make('commit', {}, () =>
    P.Effect.gen(function* () {
        const config = yield* Config;
        yield* _commit({config});
    }),
);
