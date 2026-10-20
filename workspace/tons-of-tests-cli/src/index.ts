import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {NodeServices, NodeRuntime} from '@effect/platform-node';
import {Effect, Layer, Option, References, Schema} from 'effect';

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

/** Provide once around several effectNoDeps calls to share their database connection. */
export const buildLayer = <I, O, T, A, B, S>(
    config: AppConfigShape<I, O, T, A, B, S>,
) =>
    Layer.mergeAll(
        NodeServices.layer,
        PT.TestRepository.TestRepository.layer(config.dbPath),
    );

/** Runs with platform services, TestRepository, and suite services supplied by the caller. */
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
 * Opens a database connection and provides platform services for this call.
 * The caller must provide services required by every program and the case stream.
 * Use `effectNoDeps` to share the database connection across calls.
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
        // Surface DiffNonEmpty as a plain exit code so the user sees "exit 1"
        // rather than a stack trace. Programmatic consumers using `effect`
        // still observe DiffNonEmpty in the Effect error channel.
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
 * This does not execute a program.
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
