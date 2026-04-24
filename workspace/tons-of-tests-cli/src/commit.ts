import {randomUUID} from 'node:crypto';

import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from '@effect/cli';
import {Effect} from 'effect';

import {AppConfig, type AppConfigShape} from './Config.js';

export const _commit = <I = unknown, O = unknown, T = unknown>({
    config: {testSuite},
}: {
    config: AppConfigShape<I, O, T>;
}) =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* repository.commitCurrentTestRun({
            name: testSuite.name,
            hash: randomUUID(),
        });
        yield* repository.clearStale({name: testSuite.name});
    });

export const commit = Command.make('commit', {}, () =>
    Effect.gen(function* () {
        const config = yield* AppConfig;
        yield* _commit({config});
    }),
);
