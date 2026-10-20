import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {
    Effect,
    Option,
    Schema,
    SchemaTransformation,
    Stdio,
    Stream,
} from 'effect';

import type {AppConfigShape} from './Config.js';
import {
    matchesFilters,
    resultFilterFlags,
    RunReference,
    type ResultFilters,
} from './common.js';
import {resolveRun} from './test-run.js';

const RunReferences = Schema.String.pipe(
    Schema.decodeTo(
        Schema.Array(RunReference).check(Schema.isNonEmpty()),
        SchemaTransformation.transform({
            decode: (value): readonly string[] => value.split(','),
            encode: values => values.join(','),
        }),
    ),
);

export const summarizeRuns = Effect.fn('Stats.runs')(function* <
    I,
    O,
    T,
    A,
    B,
    S,
>({
    config,
    references,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, A, B, S>;
    references?: readonly RunReference[] | undefined;
}) {
    const {testSuite} = config;
    const configured =
        testSuite.variants === undefined
            ? ['default']
            : Object.keys(testSuite.variants);
    const repository = yield* PT.TestRepository.TestRepository;
    const selections =
        references !== undefined
            ? yield* Effect.forEach(
                  references,
                  reference =>
                      resolveRun(testSuite.name, reference).pipe(
                          Effect.map(run => ({
                              name: run.name,
                              variant: run.variant,
                              run: Option.some(run),
                              retired:
                                  run.name === testSuite.name &&
                                  !configured.includes(run.variant),
                          })),
                      ),
                  {concurrency: 1},
              )
            : yield* Effect.gen(function* () {
                  const stored = yield* repository.listVariantBaselines(
                      testSuite.name,
                  );
                  const byVariant = new Map(
                      stored.map(row => [row.variant, row.baseline]),
                  );
                  return [
                      ...configured,
                      ...stored
                          .map(row => row.variant)
                          .filter(variant => !configured.includes(variant))
                          .sort(),
                  ].map(variant => ({
                      name: testSuite.name,
                      variant,
                      run: byVariant.get(variant) ?? Option.none(),
                      retired: !configured.includes(variant),
                  }));
              });
    return yield* Effect.forEach(
        selections,
        selection =>
            Effect.gen(function* () {
                const summary = Option.isSome(selection.run)
                    ? Option.some(
                          (yield* PT.Test.summarizeRun({
                              run: selection.run.value,
                              schemas: testSuite.schemas,
                              predicate: result =>
                                  matchesFilters(result, filters),
                          })).stats,
                      )
                    : Option.none();
                return {...selection, stats: summary};
            }),
        {concurrency: 1},
    );
});

export const stats = <
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
        'stats',
        {
            runs: Flag.String('runs').pipe(
                Flag.withSchema(RunReferences),
                Flag.optional,
                Flag.withDescription(
                    'List variant baselines or run:<id> references in display order, separated by commas.',
                ),
            ),
            ...resultFilterFlags,
        },
        ({runs, ...filters}) =>
            Effect.gen(function* () {
                const summaries = yield* summarizeRuns<I, O, T, A, B, S>({
                    config,
                    references: Option.getOrUndefined(runs),
                    ...filters,
                });
                const stdio = yield* Stdio.Stdio;
                yield* Stream.succeed(
                    `${PT.Show.runSummaries({summaries, displayConfig: config.displayConfig})}\n`,
                ).pipe(Stream.run(stdio.stdout()));
            }),
    ).pipe(
        Command.withDescription(
            'Summarize all selected results, including unchanged ones. Without --runs, show baselines for configured and removed variants.',
        ),
    );
