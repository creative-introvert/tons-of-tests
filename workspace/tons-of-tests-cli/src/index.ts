import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from '@effect/cli';
import {NodeContext} from '@effect/platform-node';
import {Effect, Layer, Option} from 'effect';

import type {Config} from './Config.js';
import {makeConfigLayer} from './Config.js';
import {commit} from './commit.js';
import {diff} from './diff.js';
import {summarize} from './summarize.js';
import {VERSION} from './version.js';

const cli = Command.run(
    Command.make('tons-of-tests').pipe(
        Command.withSubcommands([summarize, diff, commit]),
    ),
    {name: 'Tons Of Tests CLI', version: VERSION},
);

export const run = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): Promise<string | null> =>
    Effect.suspend(() => cli(process.argv)).pipe(
        Effect.flatMap(() =>
            Effect.gen(function* () {
                const tests = yield* PT.TestRepository.TestRepository;
                return yield* tests.getLastTestRunHash(config.testSuite.name);
            }),
        ),
        a => a,
        Effect.map(Option.getOrNull),
        Effect.provide(
            NodeContext.layer.pipe(
                Layer.merge(makeConfigLayer(config as Config)),
                Layer.provideMerge(PT.TestRepository.LiveLayer),
                Layer.provideMerge(
                    PT.TestRepository.makeSqliteLiveLayer(config.dbPath),
                ),
            ),
        ),
        Effect.runPromise,
    );
