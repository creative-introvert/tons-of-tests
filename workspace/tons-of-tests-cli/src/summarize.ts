import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Console, Effect, Option, Stdio, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {cached, resultFilterFlags, variant} from './common.js';
import {prepareReport} from './test-run.js';

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
                const report = yield* prepareReport<I, O, T, A, B, S>({
                    ...options,
                    variant: Option.getOrUndefined(options.variant),
                    config,
                    mode: 'summarize',
                });

                if (report.count === 0) {
                    yield* Console.log(
                        [
                            '┌─────────────────────────┐',
                            '│ NO TEST RESULTS VISIBLE │',
                            '└─────────────────────────┘',
                            '',
                            PT.Show.stats({testRun: report}),
                        ].join('\n'),
                    );
                    return;
                }

                const stdio = yield* Stdio.Stdio;
                yield* report.chunks.pipe(Stream.run(stdio.stdout()));
                yield* Console.log(`\n\n${PT.Show.stats({testRun: report})}`);
            }).pipe(Effect.scoped),
    ).pipe(
        Command.withDescription(
            'Execute a selected variant and summarize its filtered results.',
        ),
    );
