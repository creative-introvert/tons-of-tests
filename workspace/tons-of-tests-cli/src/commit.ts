import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Console, Effect, Option} from 'effect';

import {type AppConfigShape} from './Config.js';
import {
    exactRun,
    InvalidCommandOptions,
    variant,
    type RunReference,
} from './common.js';
import {resolveRun, selectVariants} from './test-run.js';

export const _commit = Effect.fnUntraced(function* <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>({
    config: {testSuite},
    variant,
    run,
}: {
    config: AppConfigShape<I, O, T, A, B, S>;
    variant?: string | undefined;
    run?: Extract<RunReference, {_tag: 'Run'}> | undefined;
}) {
    if (run !== undefined && variant !== undefined) {
        return yield* new InvalidCommandOptions({
            message: '--run cannot be combined with --variant.',
        });
    }
    const repository = yield* PT.TestRepository.TestRepository;
    const selections =
        run !== undefined
            ? [yield* resolveRun(testSuite.name, run)]
            : yield* Effect.forEach(
                  yield* selectVariants<I, O, T, A, B, S>(testSuite, variant),
                  variant =>
                      Effect.gen(function* () {
                          const latest = yield* repository.getLatestTestRun({
                              name: testSuite.name,
                              variant,
                          });
                          if (Option.isNone(latest))
                              return yield* new PT.Error.TestRunNotCreated({
                                  testSuiteName: testSuite.name,
                              });
                          return latest.value;
                      }),
              );
    for (const selected of selections) {
        if (selected.name !== testSuite.name) {
            return yield* new InvalidCommandOptions({
                message: `Run ${selected.id} belongs to suite ${selected.name}, not ${testSuite.name}.`,
            });
        }
    }
    const committed = yield* repository.commitTestRuns(selections);
    for (const saved of committed) {
        yield* Console.log(
            `Committed ${saved.name} / ${saved.variant} / run:${saved.id}.`,
        );
    }
});

export const commit = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
) =>
    Command.make('commit', {variant, run: exactRun}, options =>
        _commit<I, O, T, A, B, S>({
            config,
            variant: Option.getOrUndefined(options.variant),
            run: Option.getOrUndefined(options.run),
        }),
    ).pipe(
        Command.withDescription(
            'Save the exact cached results for all configured variants and select them as baselines. Every selected attempt must be complete; save all or none. Runs no programs. Use --variant to select one, or --run to restore a saved baseline.',
        ),
    );
