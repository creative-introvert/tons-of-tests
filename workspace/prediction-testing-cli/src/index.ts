import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';
import {summarize} from './summarize.js';
import {diff} from './diff.js';
import {commit} from './commit.js';
import type {Config} from './Config.js';
import {makeConfigLayer} from './Config.js';
import {version} from '../package.json' assert {type: 'json'};

const PackageJsonSchema = P.Schema.parseJson(
    P.Schema.Struct({
        // Including the name to avoid accidentally looking at another package.json, e.g. when we change folder structure.
        name: P.Schema.Literal('@creative-introvert/prediction-testing-cli'),
        version: P.Schema.String,
    }),
);

const getVersion = P.Effect.gen(function* () {
    const fs = yield* P.FS.FileSystem;
    let dirname: string;
    try {
        // for cjs
        // eslint-disable-next-line unicorn/prefer-module
        dirname = __dirname;
    } catch (e) {
        // for esm
        dirname = fileURLToPath(import.meta.url);
    }

    const raw = yield* fs
        .readFileString(path.join(dirname, '../package.json'), 'utf8')
        .pipe(
            P.Effect.orElse(() =>
                // folder structure is slightly different in released package
                fs.readFileString(
                    path.join(dirname, '../../package.json'),
                    'utf8',
                ),
            ),
        );

    const {version} = yield* P.Schema.decodeUnknown(PackageJsonSchema)(raw);
    return version;
});

const cli = (args: readonly string[], version: string) =>
    Command.run(
        Command.make('prediction-testing').pipe(
            Command.withSubcommands([summarize, diff, commit]),
        ),
        {name: 'Prediction Testing', version},
    )(args);

export const run = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): Promise<void> =>
    P.Effect.suspend(() =>
        getVersion.pipe(
            P.Effect.flatMap(version => cli(process.argv, version)),
        ),
    ).pipe(
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
