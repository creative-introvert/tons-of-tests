import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Console, Effect, Option, Stdio, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {cached, resultFilterFlags, variant} from './common.js';
import {prepareReport, selectVariants} from './test-run.js';

export const summarize = <
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
        'summarize',
        {cached, variant, ...resultFilterFlags},
        options =>
            Effect.gen(function* () {
                const variants = yield* selectVariants<I, O, T, A, B, S>(
                    config.testSuite,
                    Option.getOrUndefined(options.variant),
                );
                for (const variant of variants) {
                    yield* Effect.gen(function* () {
                        const report = yield* prepareReport<I, O, T, A, B, S>({
                            ...options,
                            variant,
                            config,
                            mode: 'summarize',
                        });
                        yield* Console.log(
                            `${report.run.name} / ${variant} (${report.source})`,
                        );
                        if (report.count === 0) {
                            yield* Console.log('NO TEST RESULTS VISIBLE');
                        } else {
                            const stdio = yield* Stdio.Stdio;
                            yield* report.chunks.pipe(
                                Stream.run(stdio.stdout()),
                            );
                        }
                        yield* Console.log(
                            `\n${PT.Show.stats({testRun: report})}`,
                        );
                    }).pipe(Effect.scoped);
                }
            }),
    ).pipe(
        Command.withDescription(
            'Run all configured variants in declaration order and summarize their filtered results. Use --variant to select one, --cached to reuse results, and commit to save snapshots. Filters affect display only.',
        ),
    );
