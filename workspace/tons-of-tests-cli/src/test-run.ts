import * as PT from '@creative-introvert/tons-of-tests';
import {Console, Effect, Option, Stream} from 'effect';

import type {AppConfigShape} from './Config.js';
import {
    matchesFilters,
    type ResultFilters,
    type RunReference,
} from './common.js';

export const resolveRun = Effect.fn('TestRun.resolve')(function* (
    name: string,
    reference: RunReference,
) {
    const repository = yield* PT.TestRepository.TestRepository;
    const selected =
        reference._tag === 'Run'
            ? yield* repository.getTestRun(reference.id)
            : yield* repository.getBaselineTestRun({
                  name,
                  variant: reference.variant,
              });
    if (Option.isNone(selected)) {
        return yield* reference._tag === 'Run'
            ? new PT.Error.TestRunNotFound({testRunId: reference.id})
            : new PT.Error.TestBaselineNotFound({
                  testSuiteName: name,
                  variant: reference.variant,
              });
    }
    if (selected.value.state !== 'Complete') {
        return yield* new PT.Error.TestRunIncomplete({
            testSuiteName: selected.value.name,
            testRunId: selected.value.id,
            variant: selected.value.variant,
        });
    }
    return selected.value;
});

const prepareRunReport = Effect.fn('TestRun.savedReport')(function* <
    I,
    O,
    T,
    A,
    B,
    S,
>({
    config,
    from,
    to,
    mode,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, A, B, S>;
    from: Option.Option<PT.TestRepository.TestRun>;
    to: PT.TestRepository.TestRun;
    mode: 'summarize' | 'diff';
}) {
    const repository = yield* PT.TestRepository.TestRepository;
    const comparisons = Option.isSome(from)
        ? PT.Test.compareRuns({
              from: from.value,
              to,
              schemas: config.testSuite.schemas,
          })
        : repository
              .getTestResultsStream(to, config.testSuite.schemas)
              .pipe(Stream.map(to => ({_tag: 'OnlyTo' as const, to})));
    return yield* repository.withStats(currentStats =>
        repository.withStats(previousStats =>
            Effect.gen(function* () {
                const rows = comparisons.pipe(
                    Stream.filter(row => {
                        if (mode === 'summarize' && row._tag === 'OnlyFrom')
                            return false;
                        if (
                            mode === 'diff' &&
                            row._tag === 'Matched' &&
                            !row.changed
                        )
                            return false;
                        return matchesFilters(
                            row._tag === 'OnlyFrom' ? row.from : row.to,
                            filters,
                        );
                    }),
                    Stream.grouped(50),
                    Stream.tap(rows =>
                        Effect.gen(function* () {
                            yield* currentStats.add(
                                rows.flatMap(row =>
                                    row._tag === 'OnlyFrom' ? [] : [row.to],
                                ),
                            );
                            yield* previousStats.add(
                                rows.flatMap(row =>
                                    row._tag === 'OnlyTo' ? [] : [row.from],
                                ),
                            );
                        }),
                    ),
                    Stream.flattenIterable,
                );
                const summary =
                    mode === 'diff'
                        ? yield* PT.Show.prepareComparison(rows, {
                              from,
                              to,
                              schemas: config.testSuite.schemas,
                              displayConfig: config.displayConfig,
                          })
                        : yield* PT.Show.prepareSummary(
                              rows.pipe(
                                  Stream.filter(row => row._tag !== 'OnlyFrom'),
                                  Stream.map(row => ({
                                      testResult: row.to,
                                      previousTestResult:
                                          row._tag === 'Matched'
                                              ? Option.some(row.from)
                                              : Option.none(),
                                  })),
                              ),
                              {
                                  schemas: config.testSuite.schemas,
                                  suite: to.name,
                                  displayConfig: config.displayConfig,
                                  hasPrevious: Option.isSome(from),
                              },
                          );
                const stats = yield* currentStats.stats;
                const before = yield* previousStats.stats;
                return {
                    ...summary,
                    run: to,
                    stats,
                    previousStats: Option.map(from, () => before),
                };
            }),
        ),
    );
});

/** Read complete saved runs without executing a program or changing a baseline. */
export const prepareSavedReport = Effect.fn('TestRun.comparison')(function* <
    I,
    O,
    T,
    A,
    B,
    S,
>({
    config,
    from,
    to,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, A, B, S>;
    from: PT.TestRepository.TestRun;
    to: PT.TestRepository.TestRun;
}) {
    return yield* prepareRunReport<I, O, T, A, B, S>({
        ...filters,
        config,
        from: Option.some(from),
        to,
        mode: 'diff',
    });
});

/** Save the full run before reading report rows. Report failures leave the completed run unchanged. */
export const prepareReport = Effect.fn('TestRun.report')(function* <
    I,
    O,
    T,
    A,
    B,
    S,
>({
    config,
    cached,
    variant,
    mode,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, A, B, S>;
    cached: boolean;
    variant?: string | undefined;
    mode: 'summarize' | 'diff';
}) {
    const selected = yield* PT.Test.selectVariant(config.testSuite, variant);
    const repository = yield* PT.TestRepository.TestRepository;
    const identity = {name: config.testSuite.name, variant: selected.name};
    const previous = yield* repository.getBaselineTestRun(identity);
    const latest = cached
        ? yield* repository.getLatestTestRun(identity)
        : Option.none();
    const reused = Option.isSome(latest) && latest.value.state === 'Complete';
    const run =
        reused && Option.isSome(latest)
            ? latest.value
            : (yield* repository.withTestRun(identity, run =>
                  PT.Test.all<I, O, T, A, B, S>(config.testSuite, {
                      variant: selected.name,
                      concurrency: config.concurrency,
                  }).pipe(
                      Stream.grouped(50),
                      Stream.runForEach(results =>
                          repository.insertTestResults(
                              results,
                              run,
                              config.testSuite.schemas,
                          ),
                      ),
                  ),
              )).run;
    yield* Console.log(
        `${reused ? 'Reused' : 'Created'} ${run.name} / ${run.variant} / run:${run.id}.`,
    );
    const report = yield* prepareRunReport<I, O, T, A, B, S>({
        ...filters,
        config,
        from: previous,
        to: run,
        mode,
    });
    return {...report, reused};
});
