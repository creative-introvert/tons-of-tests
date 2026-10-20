import * as PT from '@creative-introvert/tons-of-tests';
import {Effect, Option, Stream} from 'effect';

import type {AppConfigShape} from './Config.js';
import {matchesFilters, type ResultFilters} from './common.js';

/** Cache only successful whole-suite executions. Failed attempts remain uncommittable. */
const withCurrentTestRunResults = Effect.fn('TestRun.current')(function* <
    I,
    O,
    T,
    E,
    R,
    A,
    B,
    X,
    Y,
    Z,
>(
    {testSuite, concurrency}: AppConfigShape<I, O, T, E, R, A, B>,
    cached: boolean,
    use: (
        results: Stream.Stream<
            PT.Test.TestResult<I, A, B>,
            E | PT.Error.RepositoryError,
            R
        >,
    ) => Effect.Effect<X, Y, Z>,
) {
    const repository = yield* PT.TestRepository.TestRepository;
    const run = yield* repository.getOrCreateCurrentTestRun(testSuite.name);
    if (cached && (yield* repository.isComplete(run))) {
        return yield* use(
            repository.getTestResultsStream<I, A, B>(run, testSuite.schemas),
        );
    }
    return yield* repository.withTestRun(
        run,
        use(
            PT.Test.all(testSuite, {concurrency}).pipe(
                Stream.grouped(50),
                Stream.tap(results =>
                    repository.insertTestResults(results, run),
                ),
                Stream.flattenIterable,
            ),
        ),
    );
});

/** Prepare output in batches, retaining only the matching previous batch in memory. */
export const prepareReport = Effect.fn('TestRun.report')(function* <
    I,
    O,
    T,
    E,
    R,
    A,
    B,
>({
    config,
    cached,
    mode,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, E, R, A, B>;
    cached: boolean;
    mode: 'summarize' | 'diff';
}) {
    const repository = yield* PT.TestRepository.TestRepository;
    const previous = yield* repository.getPreviousTestRun(
        config.testSuite.name,
    );
    return yield* repository.withStats(currentStats =>
        repository.withStats(previousStats =>
            withCurrentTestRunResults(config, cached, results =>
                Effect.gen(function* () {
                    const rows = results.pipe(
                        Stream.grouped(50),
                        Stream.mapEffect(
                            Effect.fnUntraced(function* (batch) {
                                const byKey = new Map<
                                    string,
                                    PT.Test.TestResult<I, A, B>
                                >();
                                if (Option.isSome(previous)) {
                                    yield* repository
                                        .getTestResultsStream<I, A, B>(
                                            previous.value,
                                            config.testSuite.schemas,
                                            batch,
                                        )
                                        .pipe(
                                            Stream.runForEach(result =>
                                                Effect.sync(() => {
                                                    byKey.set(
                                                        PT.Test.resultKey(
                                                            result,
                                                        ),
                                                        result,
                                                    );
                                                }),
                                            ),
                                        );
                                }
                                const selected = batch.flatMap(testResult => {
                                    if (!matchesFilters(testResult, filters))
                                        return [];
                                    const previousTestResult =
                                        Option.fromNullishOr(
                                            byKey.get(
                                                PT.Test.resultKey(testResult),
                                            ),
                                        );
                                    if (
                                        mode === 'diff' &&
                                        Option.isSome(previousTestResult)
                                    ) {
                                        const before = previousTestResult.value;
                                        if (
                                            testResult.label === before.label &&
                                            PT.Classify.defaultIsEqual(
                                                testResult.result,
                                                before.result,
                                            ) &&
                                            PT.Classify.defaultIsEqual(
                                                testResult.expected,
                                                before.expected,
                                            )
                                        )
                                            return [];
                                    }
                                    return [{testResult, previousTestResult}];
                                });
                                yield* currentStats.add(
                                    selected.map(row => row.testResult),
                                );
                                yield* previousStats.add(
                                    selected.flatMap(row =>
                                        Option.isSome(row.previousTestResult)
                                            ? [row.previousTestResult.value]
                                            : [],
                                    ),
                                );
                                return selected;
                            }),
                        ),
                        Stream.flattenIterable,
                    );
                    const summary = yield* PT.Show.prepareSummary(rows, {
                        displayConfig: config.displayConfig,
                        hasPrevious: Option.isSome(previous),
                    });
                    const stats = yield* currentStats.stats;
                    const before = yield* previousStats.stats;
                    return {
                        ...summary,
                        stats,
                        previousStats: Option.map(previous, () => before),
                    };
                }),
            ),
        ),
    );
});
