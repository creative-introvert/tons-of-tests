import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Console, Effect, Stdio, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {cached, resultFilterFlags} from './common.js';
import {prepareReport} from './test-run.js';

export const summarize = <
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
    Command.make('summarize', {cached, ...resultFilterFlags}, options =>
        Effect.gen(function* () {
            const report = yield* prepareReport({
                ...options,
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
    );
