import * as PT from '@creative-introvert/tons-of-tests';
import {Command} from 'effect/cli';
import {Console, Effect, Stream} from 'effect';

import {type AppConfigShape} from './Config.js';
import {
    cached,
    getPreviousTestRunResults,
    matchesFilters,
    resultFilterFlags,
    type ResultFilters,
} from './common.js';

export const _sumarize = Effect.fn('summarize')(function* <
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
    yield* Effect.logDebug('repository');

    const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
        testSuite.name,
    );
    yield* Effect.logDebug('currentTestRun');

    const hasResults = yield* tests.hasResults(currentTestRun);
    yield* Effect.logDebug('hasResults');

    const getFromRun = () =>
        tests.clearUncommitedTestResults({name: testSuite.name}).pipe(
            Effect.flatMap(() =>
                PT.Test.all(testSuite, {
                    concurrency: concurrency || 1,
                }).pipe(
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

    const testRun = PT.Test.filterResults(fullTestRun, result =>
        matchesFilters(result, filters),
    );

    yield* Effect.logDebug('testRun');

    const previousTestRun = yield* getPreviousTestRunResults(testSuite);

    yield* Effect.logDebug('previousTestRun');
    return {testRun, previousTestRun};
});

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
            const {displayConfig} = config;
            const {testRun, previousTestRun} = yield* _sumarize({
                ...options,
                config,
            });

            if (testRun.testResultKeys.length === 0) {
                yield* Console.log(
                    [
                        '┌─────────────────────────┐',
                        '│ NO TEST RESULTS VISIBLE │',
                        '└─────────────────────────┘',
                        '',
                        PT.Show.stats({testRun}),
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
                ].join('\n'),
            );
        }),
    );
