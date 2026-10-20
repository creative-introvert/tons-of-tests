import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {Console, Effect, Option, Schema, Stdio, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {
    InvalidCommandOptions,
    resultFilterFlags,
    RunReference,
    variant,
} from './common.js';
import {prepareReport, prepareSavedReport, resolveRun} from './test-run.js';

/**
 * Raised when `diff --exit-on-diff` finds visible changed, added, or removed rows.
 * `CLI.run` sets exit code 1; `CLI.effect` exposes this typed failure.
 */
export class DiffNonEmpty extends Schema.TaggedError<
    DiffNonEmpty,
    {readonly brand: unique symbol}
>()('DiffNonEmpty', {count: Schema.Int}) {}

const exitOnDiff = Flag.Boolean('exit-on-diff').pipe(
    Flag.withDefault(false),
    Flag.withDescription(
        'Exit with code 1 when the filtered view contains differences.',
    ),
);

export const diff = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
) =>
    Command.make(
        'diff',
        {
            exitOnDiff,
            cached: Flag.Boolean('cached').pipe(
                Flag.optional,
                Flag.withDescription(
                    'Reuse the latest attempt only if it is Complete, even if it is the baseline. Otherwise start a new run.',
                ),
            ),
            variant,
            from: Flag.String('from').pipe(
                Flag.withSchema(RunReference),
                Flag.optional,
                Flag.withDescription(
                    'Use a variant baseline or exact run:<id> as the from side.',
                ),
            ),
            to: Flag.String('to').pipe(
                Flag.withSchema(RunReference),
                Flag.optional,
                Flag.withDescription(
                    'Use a variant baseline or exact run:<id> as the to side.',
                ),
            ),
            ...resultFilterFlags,
        },
        ({exitOnDiff, cached, variant, from, to, ...filters}) =>
            Effect.gen(function* () {
                const explicit = Option.isSome(from) || Option.isSome(to);
                if (explicit && (Option.isNone(from) || Option.isNone(to))) {
                    return yield* new InvalidCommandOptions({
                        message: 'Explicit diff requires both --from and --to.',
                    });
                }
                if (
                    explicit &&
                    (Option.isSome(variant) || Option.isSome(cached))
                ) {
                    return yield* new InvalidCommandOptions({
                        message:
                            '--from and --to cannot be combined with --variant or --cached.',
                    });
                }
                const report =
                    Option.isSome(from) && Option.isSome(to)
                        ? yield* prepareSavedReport<I, O, T, A, B, S>({
                              config,
                              from: yield* resolveRun(
                                  config.testSuite.name,
                                  from.value,
                              ),
                              to: yield* resolveRun(
                                  config.testSuite.name,
                                  to.value,
                              ),
                              ...filters,
                          })
                        : yield* prepareReport<I, O, T, A, B, S>({
                              config,
                              cached: Option.getOrElse(cached, () => false),
                              variant: Option.getOrUndefined(variant),
                              mode: 'diff',
                              ...filters,
                          });

                const stdio = yield* Stdio.Stdio;
                yield* report.chunks.pipe(Stream.run(stdio.stdout()));
                if (report.count === 0)
                    yield* Console.log('NO TEST RESULTS VISIBLE');
                yield* Console.log(
                    [
                        '',
                        'Statistics for visible changed, added, and removed rows:',
                        PT.Show.stats({testRun: report}),
                        PT.Show.diff({
                            diff: PT.Test.diff({
                                testRun: report,
                                previousTestRun: Option.map(
                                    report.previousStats,
                                    stats => ({stats}),
                                ),
                            }),
                        }),
                    ].join('\n'),
                );
                if (exitOnDiff && report.count > 0)
                    return yield* new DiffNonEmpty({count: report.count});
            }).pipe(Effect.scoped),
    ).pipe(
        Command.withDescription(
            'Compare a new or cached run with its baseline, or compare saved runs using --from and --to. Statistics count only visible changed, added, and removed rows. Use stats for all selected results.',
        ),
    );
