import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {NodeServices, NodeRuntime} from '@effect/platform-node';
import {Effect, Layer, Option, References} from 'effect';

import type {AppConfigShape} from './Config.js';
import {commit} from './commit.js';
import {DiffNonEmpty, diff} from './diff.js';
import {summarize} from './summarize.js';
import {VERSION} from './version.js';

const makeCli = <I, O, T, E, R, A, B>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
) =>
    Command.make('tons-of-tests').pipe(
        Command.withSubcommands([
            summarize(config),
            diff(config),
            commit(config),
        ]),
    );

/** Provide once around several effectNoDeps calls to share their database connection. */
export const buildLayer = <I, O, T, E, R, A, B>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
) =>
    Layer.mergeAll(
        NodeServices.layer,
        PT.TestRepository.TestRepository.layer(config.dbPath),
    );

/** Runs with caller-provided platform services and a shared TestRepository. */
export const effectNoDeps = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
    A = O,
    B = T,
>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
    args?: ReadonlyArray<string>,
) =>
    Effect.suspend(() => {
        const command = makeCli(config);
        return args === undefined
            ? Command.run(command, {version: VERSION, renderErrors: false})
            : Command.runWith(command, {version: VERSION, renderErrors: false})(
                  args.slice(2),
              );
    });

/** Opens a database connection for this invocation. Use effectNoDeps to share services. */
export const effect = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
    A = O,
    B = T,
>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
    args?: ReadonlyArray<string>,
) => effectNoDeps(config, args).pipe(Effect.provide(buildLayer(config)));

export const run = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    A = O,
    B = T,
>(
    config: AppConfigShape<I, O, T, E, never, A, B>,
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
    A = O,
    B = T,
>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
): Promise<string | null> =>
    Effect.gen(function* () {
        const repo = yield* PT.TestRepository.TestRepository;
        const hash = yield* repo.getLastTestRunHash(config.testSuite.name);
        return Option.getOrNull(hash);
    }).pipe(Effect.provide(buildLayer(config)), Effect.runPromise);

export {DiffNonEmpty};
export type {AppConfigShape as Config} from './Config.js';
