import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import * as P from './prelude.js';
import {summarize} from './summarize.js';
import {diff} from './diff.js';
import {commit} from './commit.js';
import type {Config} from './Config.js';
import {makeConfigLayer} from './Config.js';
import {VERSION} from './version.js';

const cli = Command.run(
    Command.make('tons-of-tests').pipe(
        Command.withSubcommands([summarize, diff, commit]),
    ),
    {name: 'Prediction Testing', version: VERSION},
);

export const run = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): Promise<void> =>
    P.Effect.suspend(() => cli(process.argv)).pipe(
        P.Effect.provide(
            P.NodeContext.layer.pipe(
                P.Layer.merge(makeConfigLayer(config as Config)),
                P.Layer.provideMerge(PT.TestRepository.LiveLayer),
                P.Layer.provideMerge(
                    PT.TestRepository.makeSqliteLiveLayer(config.dbPath),
                ),
            ),
        ),
        P.Effect.runPromise,
    );
