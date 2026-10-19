import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {Console, Effect, Option, Schema, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {
    cached,
    getPreviousTestRunResults,
    matchesFilters,
    resultFilterFlags,
    type ResultFilters,
} from './common.js';

/**
 * Raised when `diff --exit-on-diff` finds visible changed results.
 * `CLI.run` sets exit code 1; `CLI.effect` exposes this typed failure.
 */
export class DiffNonEmpty extends Schema.TaggedError<
    DiffNonEmpty,
    {readonly brand: unique symbol}
>()('DiffNonEmpty', {count: Schema.Int}) {}

const exitOnDiff = Flag.Boolean('exit-on-diff').pipe(
    Flag.withDescription(
        'Exit with code 1 when the filtered view contains differences.',
    ),
);

export const _diff = Effect.fnUntraced(function* <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
    A = O,
    B = T,
>({
    cached,
    config: {testSuite, concurrency},
    ...filters
}: ResultFilters & {
    cached: boolean;
    config: AppConfigShape<I, O, T, E, R, A, B>;
}) {
    const tests = yield* PT.TestRepository.TestRepository;

    const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
        testSuite.name,
    );
    const hasResults = yield* tests.hasResults(currentTestRun);

    const fullPreviousTestRun = yield* getPreviousTestRunResults(testSuite);

    const hasChanged = (next: PT.Test.TestResult<I, A, B>): boolean =>
        fullPreviousTestRun.pipe(
            Option.flatMap(_ =>
                Option.fromNullishOr(
                    _.testResultsByKey[PT.Test.resultKey(next)],
                ),
            ),
            Option.map(
                prev =>
                    prev.label !== next.label ||
                    // FIXME: pass in from config
                    !PT.Classify.defaultIsEqual(next.result, prev.result) ||
                    !PT.Classify.defaultIsEqual(next.expected, prev.expected),
            ),
            Option.getOrElse(() => true),
        );

    const getFromRun = () =>
        tests.clearUncommitedTestResults({name: testSuite.name}).pipe(
            Effect.flatMap(() =>
                PT.Test.all(testSuite, {concurrency}).pipe(
                    Stream.grouped(50),
                    Stream.tap(group =>
                        tests.insertTestResults(group, currentTestRun),
                    ),
                    Stream.flattenIterable,
                    PT.Test.runCollectRecord(currentTestRun),
                    Effect.tap(Effect.logDebug('from run')),
                ),
            ),
        );

    const getFromCache = () =>
        tests
            .getTestResultsStream<I, A, B>(currentTestRun, testSuite.schemas)
            .pipe(
                PT.Test.runCollectRecord(currentTestRun),
                Effect.tap(Effect.logDebug('from cache')),
            );

    const fullTestRun: PT.Test.TestRunResults<I, A, B> = yield* cached &&
    hasResults
        ? getFromCache()
        : getFromRun();

    const testRun = PT.Test.filterResults(
        fullTestRun,
        result => hasChanged(result) && matchesFilters(result, filters),
    );
    const visibleKeys = new Set(testRun.testResultKeys);
    const previousTestRun = fullPreviousTestRun.pipe(
        Option.map(previous =>
            PT.Test.filterResults(previous, result =>
                visibleKeys.has(PT.Test.resultKey(result)),
            ),
        ),
    );

    return {testRun, previousTestRun};
});

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
                const {displayConfig} = config;
                const {testRun, previousTestRun} = yield* _diff({
                    ...options,
                    config,
                });

                if (testRun.testResultKeys.length === 0) {
                    yield* Console.log(
                        [
                            '┌─────────────────────────┐',
                            '│ NO TEST RESULTS VISIBLE │',
                            '└─────────────────────────┘',
                        ].join('\n'),
                    );
                    return;
                }

                yield* Console.log(
                    [
                        PT.Show.summarize({
                            testRun,
                            previousTestRun,
                            displayConfig,
                        }),
                        '',
                        PT.Show.stats({testRun}),
                        '',
                        PT.Show.diff({
                            diff: PT.Test.diff({testRun, previousTestRun}),
                        }),
                    ].join('\n'),
                );
                if (exitOnDiff) {
                    return yield* new DiffNonEmpty({
                        count: testRun.testResultKeys.length,
                    });
                }
            }),
    );
