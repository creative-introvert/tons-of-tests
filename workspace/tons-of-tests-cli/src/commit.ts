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
import {resolveRun} from './test-run.js';

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
    const selected =
        run !== undefined
            ? yield* resolveRun(testSuite.name, run)
            : yield* Effect.gen(function* () {
                  const selected = yield* PT.Test.selectVariant(
                      testSuite,
                      variant,
                  );
                  const latest = yield* repository.getLatestTestRun({
                      name: testSuite.name,
                      variant: selected.name,
                  });
                  if (Option.isNone(latest))
                      return yield* new PT.Error.TestRunNotCreated({
                          testSuiteName: testSuite.name,
                      });
                  return latest.value;
              });
    if (selected.name !== testSuite.name) {
        return yield* new InvalidCommandOptions({
            message: `Run ${selected.id} belongs to suite ${selected.name}, not ${testSuite.name}.`,
        });
    }
    yield* repository.commitTestRun(selected.id);
    yield* Console.log(
        `Committed ${selected.name} / ${selected.variant} / run:${selected.id}.`,
    );
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
            'Set a variant baseline to its latest attempt or an exact run ID. The run must be Complete. All history is kept.',
        ),
    );
