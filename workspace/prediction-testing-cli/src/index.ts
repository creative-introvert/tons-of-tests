import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';
import {summarize} from './summarize.js';
import {diff} from './diff.js';
import {commit} from './commit.js';
import type {Config} from './Config.js';
import {makeConfigLayer} from './Config.js';

const cli = Command.run(
    Command.make('prediction-testing').pipe(
        Command.withSubcommands([summarize, diff, commit]),
    ),
    {
        name: 'Prediction Testing',
        // FIXME
        version: 'v0.0.1',
    },
);

export const run = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): void =>
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
        P.NodeRuntime.runMain,
    );