import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {NodeServices, NodeRuntime} from '@effect/platform-node';
import {Effect, Layer, Option, References} from 'effect';

import type {AppConfigShape} from './Config.js';
import {commit} from './commit.js';
import {DiffNonEmpty, diff} from './diff.js';
import {summarize} from './summarize.js';
import {VERSION} from './version.js';

const makeCli = <I, O, T, E, R>(config: AppConfigShape<I, O, T, E, R>) =>
    Command.make('tons-of-tests').pipe(
        Command.withSubcommands([
            summarize(config),
            diff(config),
            commit(config),
        ]),
    );

// Each call builds an independent layer (and therefore an independent
// SqliteClient). Exported so callers running multiple operations in-process
// can share a single layer across them.
export const buildLayer = <I, O, T, E, R>(
    config: AppConfigShape<I, O, T, E, R>,
) =>
    Layer.mergeAll(
        NodeServices.layer,
        PT.TestRepository.TestRepository.layer(config.dbPath),
    );

export const effect = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>(
    config: AppConfigShape<I, O, T, E, R>,
    args?: ReadonlyArray<string>,
) =>
    Effect.suspend(() => {
        const command = makeCli(config);
        return args === undefined
            ? Command.run(command, {version: VERSION, renderErrors: false})
            : Command.runWith(command, {version: VERSION, renderErrors: false})(
                  args.slice(2),
              );
    }).pipe(Effect.provide(buildLayer(config)));

export const run = <I = unknown, O = unknown, T = unknown, E = never>(
    config: AppConfigShape<I, O, T, E, never>,
    args?: ReadonlyArray<string>,
): void =>
    effect(config, args).pipe(
        // Surface DiffNonEmpty as a plain exit code so the user sees "exit 1"
        // rather than a stack trace. Programmatic consumers using `effect`
        // still observe DiffNonEmpty in the Effect error channel.
        Effect.catchTag('DiffNonEmpty', () =>
            Effect.sync(() => {
                process.exitCode = 1;
            }),
        ),
        Effect.provideService(References.MinimumLogLevel, 'Info'),
        NodeRuntime.runMain,
    );

export const getLastTestRunHash = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>(
    config: AppConfigShape<I, O, T, E, R>,
): Promise<string | null> =>
    Effect.gen(function* () {
        const repo = yield* PT.TestRepository.TestRepository;
        const hash = yield* repo.getLastTestRunHash(config.testSuite.name);
        return Option.getOrNull(hash);
    }).pipe(Effect.provide(buildLayer(config)), Effect.runPromise);

export {DiffNonEmpty};
export type {AppConfigShape as Config} from './Config.js';
