import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Crypto, Effect} from 'effect';

import {type AppConfigShape} from './Config.js';

export const _commit = Effect.fnUntraced(function* <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>({config: {testSuite}}: {config: AppConfigShape<I, O, T, E, R>}) {
    const repository = yield* PT.TestRepository.TestRepository;
    const crypto = yield* Crypto.Crypto;
    yield* repository.commitCurrentTestRun({
        name: testSuite.name,
        hash: yield* crypto.randomUUIDv4({format: 'hex'}),
    });
    yield* repository.clearStale({name: testSuite.name});
});

export const commit = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>(
    config: AppConfigShape<I, O, T, E, R>,
) => Command.make('commit', {}, () => _commit({config}));
