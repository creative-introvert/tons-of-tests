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
import {
    prepareReport,
    prepareSavedReport,
    resolveRun,
    selectVariants,
} from './test-run.js';

/**
 * Raised when `diff --exit-on-diff` finds visible changed, added, or removed rows.
 * All selected variants are shown before this failure is returned.
 * Execution and report errors still stop the command immediately.
 * `CLI.run` sets exit code 1; `CLI.effect` exposes this typed failure.
 */
export class DiffNonEmpty extends Schema.TaggedError<
    DiffNonEmpty,
    {readonly brand: unique symbol}
>()('DiffNonEmpty', {count: Schema.Int}) {}

const exitOnDiff = Flag.Boolean('exit-on-diff').pipe(
    Flag.withDefault(false),
    Flag.withDescription(
        'Show all selected variants, then exit with code 1 if any filtered view contains differences.',
    ),
);

const renderDiff = Effect.fn('Diff.render')(function* (
    report: Effect.Success<ReturnType<typeof prepareSavedReport>>,
) {
    if (Option.isNone(report.previousStats)) {
        yield* Console.log(
            'No committed baseline. Selected results are shown as added.',
        );
    }
    const stdio = yield* Stdio.Stdio;
    yield* report.chunks.pipe(Stream.run(stdio.stdout()));
    if (report.count === 0) yield* Console.log('NO TEST RESULTS VISIBLE');
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
    return report.count;
});

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
                    'Reuse each variant’s latest cached attempt if complete, even after code changes. Rerun missing, running, or failed attempts.',
                ),
            ),
            variant,
            from: Flag.String('from').pipe(
                Flag.withSchema(RunReference),
                Flag.optional,
                Flag.withDescription(
                    'Use a saved variant baseline or run:<id> snapshot as the from side. Requires --to; cannot be combined with --variant or --cached.',
                ),
            ),
            to: Flag.String('to').pipe(
                Flag.withSchema(RunReference),
                Flag.optional,
                Flag.withDescription(
                    'Use a saved variant baseline or run:<id> snapshot as the to side. Requires --from; cannot be combined with --variant or --cached.',
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
                let count = 0;
                if (Option.isSome(from) && Option.isSome(to)) {
                    const report = yield* prepareSavedReport<I, O, T, A, B, S>({
                        config,
                        from: yield* resolveRun(
                            config.testSuite.name,
                            from.value,
                        ),
                        to: yield* resolveRun(config.testSuite.name, to.value),
                        ...filters,
                    });
                    yield* Console.log('Committed snapshots');
                    count = yield* renderDiff(report);
                } else {
                    const variants = yield* selectVariants<I, O, T, A, B, S>(
                        config.testSuite,
                        Option.getOrUndefined(variant),
                    );
                    for (const selected of variants) {
                        count += yield* Effect.gen(function* () {
                            const report = yield* prepareReport<
                                I,
                                O,
                                T,
                                A,
                                B,
                                S
                            >({
                                config,
                                cached: Option.getOrElse(cached, () => false),
                                variant: selected,
                                mode: 'diff',
                                ...filters,
                            });
                            yield* Console.log(
                                `${report.run.name} / ${selected} (${report.source})`,
                            );
                            return yield* renderDiff(report);
                        }).pipe(Effect.scoped);
                    }
                }
                if (exitOnDiff && count > 0)
                    return yield* new DiffNonEmpty({count});
            }).pipe(Effect.scoped),
    ).pipe(
        Command.withDescription(
            'Run all configured variants and compare each with its committed baseline. Without a baseline, show results as added. Use --cached to reuse results, or --from and --to to compare saved snapshots without running programs. Statistics count visible changes only.',
        ),
    );
