import {randomUUID} from 'node:crypto';

import {Command} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import {Config} from './Config.js';
import { Console, Effect } from 'effect';

export const _commit = <I = unknown, O = unknown, T = unknown>({
    config: {testSuite},
}: {
    config: Config<I, O, T>;
}) =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* repository.commitCurrentTestRun({
            name: testSuite.name,
            hash: randomUUID(),
        });
        yield* repository.clearStale({name: testSuite.name});
        yield* Console.log(`Commited test run and cleared stale.`);
    });

export const commit = Command.make('commit', {}, () =>
    Effect.gen(function* () {
        const config = yield* Config;
        yield* _commit({config});
    }),
);
