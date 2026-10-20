import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {NodeServices, NodeRuntime} from '@effect/platform-node';
import {Crypto, Effect, Layer, Option, Path, References, Schema} from 'effect';
import * as Hex from 'effect/encoding/Hex';

import type {AppConfigShape} from './Config.js';
import {commit} from './commit.js';
import {DiffNonEmpty, diff} from './diff.js';
import {summarize} from './summarize.js';
import {stats} from './stats.js';
import {runs} from './runs.js';
import {VERSION} from './version.js';

const makeCli = <I, O, T, A, B, S>(config: AppConfigShape<I, O, T, A, B, S>) =>
    Command.make('tons-of-tests').pipe(
        Command.withSubcommands([
            summarize<I, O, T, A, B, S>(config),
            diff<I, O, T, A, B, S>(config),
            commit<I, O, T, A, B, S>(config),
            stats<I, O, T, A, B, S>(config),
            runs<I, O, T, A, B, S>(config),
        ]),
    );

/**
 * Provide this layer once around several `effectNoDeps` calls to share their stores.
 * A `:memory:` snapshot baseline lasts until the layer closes. Separate CLI processes
 * can reuse its default disk cache, but they do not share its baseline.
 */
export const buildLayer = <I, O, T, A, B, S>(
    config: AppConfigShape<I, O, T, A, B, S>,
) =>
    Layer.provideMerge(
        Layer.unwrap(
            Effect.gen(function* () {
                const path = yield* Path.Path;
                const crypto = yield* Crypto.Crypto;
                const workingDirectory = path.resolve('.');
                const dbPath =
                    config.dbPath === ':memory:'
                        ? ':memory:'
                        : path.resolve(workingDirectory, config.dbPath);
                const snapshotIdentity =
                    dbPath === ':memory:'
                        ? `:memory:${workingDirectory}`
                        : dbPath;
                const cachePath =
                    config.cachePath === ':memory:'
                        ? ':memory:'
                        : config.cachePath === undefined
                          ? path.join(
                                workingDirectory,
                                '.cache',
                                'tons-of-tests',
                                `${Hex.encode(
                                    yield* crypto.digest(
                                        'SHA-256',
                                        new TextEncoder().encode(
                                            snapshotIdentity,
                                        ),
                                    ),
                                )}.sqlite`,
                            )
                          : path.resolve(workingDirectory, config.cachePath);

                return PT.TestRepository.TestRepository.layer({
                    dbPath,
                    cachePath,
                    snapshotIdentity,
                });
            }),
        ),
        NodeServices.layer,
    );

/**
 * Runs a command with platform services, `TestRepository`, and suite services
 * supplied by the caller. Use one shared `buildLayer` to keep stores across calls.
 */
export const effectNoDeps = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
    args?: ReadonlyArray<string>,
) =>
    Effect.suspend(() => {
        const command = makeCli<I, O, T, A, B, S>(config);
        return args === undefined
            ? Command.run(command, {version: VERSION, renderErrors: false})
            : Command.runWith(command, {version: VERSION, renderErrors: false})(
                  args.slice(2),
              );
    });

/**
 * Opens the run cache and provides platform services for this call.
 * The caller must provide services required by every program and the case stream.
 * Use `effectNoDeps` with one `buildLayer` to retain an in-memory baseline across calls.
 */
export const effect = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
    args?: ReadonlyArray<string>,
) =>
    effectNoDeps<I, O, T, A, B, S>(config, args).pipe(
        Effect.provide(buildLayer<I, O, T, A, B, S>(config)),
    );

/**
 * Runs suites whose programs and case stream need no Effect services.
 * For a suite that needs services, use `effect` and provide them there.
 */
export function run<
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S> & {
        testSuite: PT.Test.TestSuite<I, O, T, unknown, never, A, B>;
    },
    args?: ReadonlyArray<string>,
): void;
export function run<I, O, T, E, A = O, B = T>(
    config: AppConfigShape<
        I,
        O,
        T,
        A,
        B,
        PT.Test.TestSuite<I, O, T, E, never, A, B>
    >,
    args?: ReadonlyArray<string>,
): void {
    effect<I, O, T, A, B, PT.Test.TestSuite<I, O, T, E, never, A, B>>(
        config,
        args,
    ).pipe(
        // CLI callers get exit code 1 after all variants are shown.
        // Callers of `effect` receive DiffNonEmpty in the error channel.
        Effect.catchIf(Schema.is(DiffNonEmpty), () =>
            Effect.sync(() => {
                process.exitCode = 1;
            }),
        ),
        Effect.provideService(References.MinimumLogLevel, 'Info'),
        NodeRuntime.runMain,
    );
}

/**
 * Return the selected variant's baseline, or `null` if none is saved.
 * Reads snapshots without executing a program or creating a missing snapshot file.
 * This call opens its own layer, so a `:memory:` snapshot has no saved baseline here.
 */
export const getBaselineRun = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
    variant?: string,
): Promise<PT.TestRepository.TestRun | null> =>
    Effect.gen(function* () {
        const repo = yield* PT.TestRepository.TestRepository;
        const selected = yield* PT.Test.selectVariant(
            config.testSuite,
            variant,
        );
        const baseline = yield* repo.getBaselineTestRun({
            name: config.testSuite.name,
            variant: selected.name,
        });
        return Option.getOrNull(baseline);
    }).pipe(
        Effect.provide(buildLayer<I, O, T, A, B, S>(config)),
        Effect.runPromise,
    );

export {DiffNonEmpty};
export type {AppConfigShape as Config} from './Config.js';
