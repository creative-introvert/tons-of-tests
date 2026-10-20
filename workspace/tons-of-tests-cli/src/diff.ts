import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {Console, Effect, Option, Schema, Stdio, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {cached, resultFilterFlags} from './common.js';
import {prepareReport} from './test-run.js';

/**
 * Raised when `diff --exit-on-diff` finds visible changed results.
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
    E = never,
    R = never,
    A = O,
    B = T,
>(
    config: AppConfigShape<I, O, T, E, R, A, B>,
) =>
    Command.make(
        'diff',
        {exitOnDiff, cached, ...resultFilterFlags},
        ({exitOnDiff, ...options}) =>
            Effect.gen(function* () {
                const report = yield* prepareReport({
                    ...options,
                    config,
                    mode: 'diff',
                });

                if (report.count === 0) {
                    yield* Console.log(
                        [
                            '┌─────────────────────────┐',
                            '│ NO TEST RESULTS VISIBLE │',
                            '└─────────────────────────┘',
                        ].join('\n'),
                    );
                    return;
                }

                const stdio = yield* Stdio.Stdio;
                yield* report.chunks.pipe(Stream.run(stdio.stdout()));
                yield* Console.log(
                    [
                        '',
                        '',
                        PT.Show.stats({testRun: report}),
                        '',
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
                if (exitOnDiff) {
                    return yield* new DiffNonEmpty({
                        count: report.count,
                    });
                }
            }).pipe(Effect.scoped),
    );
