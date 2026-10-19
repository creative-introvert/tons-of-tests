import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {Console, Effect, Option, Schema, Stream, pipe} from 'effect';

import {type AppConfigShape} from './Config.js';
import {cached, getPreviousTestRunResults} from './common.js';

// Raised when `diff --exit-on-diff` is set and the diff is non-empty.
// The CLI entry point translates this to process.exitCode = 1; programmatic
// consumers of `_diff` observe it as a typed failure in the Effect channel.
export class DiffNonEmpty extends Schema.TaggedError<
    DiffNonEmpty,
    {readonly brand: unique symbol}
>()('DiffNonEmpty', {count: Schema.Int}) {}

const exitOnDiff = Flag.Boolean('exit-on-diff').pipe(
    Flag.withDescription(
        'Will exit with non-zero status if there are differences',
    ),
);

export const _diff = Effect.fnUntraced(function* <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>({
    cached,
    config: {testSuite, concurrency},
}: {
    cached: boolean;
    config: AppConfigShape<I, O, T, E, R>;
}) {
    const tests = yield* PT.TestRepository.TestRepository;

    const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
        testSuite.name,
    );
    const hasResults = yield* tests.hasResults(currentTestRun);

    const previousTestRun = yield* getPreviousTestRunResults(testSuite);

    const shouldInclude = (next: PT.Test.TestResult<I, O, T>): boolean =>
        previousTestRun.pipe(
            Option.flatMap(_ =>
                Option.fromNullishOr(
                    _.testResultsByTestCaseHash[next.hashTestCase],
                ),
            ),
            Option.map(
                prev =>
                    prev.label !== next.label ||
                    // FIXME: pass in from config
                    !PT.Classify.defaultIsEqual(next.result, prev.result),
            ),
            Option.getOrElse(() => true),
        );

    // Diff statistics describe the visible results.
    const foldOver = <E, R>(
        src$: Stream.Stream<PT.Test.TestResult<I, O, T>, E, R>,
    ) =>
        src$.pipe(
            Stream.filter(shouldInclude),
            PT.Test.runCollectRecord(currentTestRun),
        );

    const getFromRun = () =>
        pipe(
            PT.Test.all(testSuite, {concurrency}),
            Stream.grouped(50),
            Stream.tap(group => tests.insertTestResults(group, currentTestRun)),
            Stream.flattenIterable,
            foldOver,
            Effect.tap(Effect.logDebug('from run')),
        );

    const getFromCache = () =>
        tests
            .getTestResultsStream<I, O, T>(currentTestRun, testSuite.schemas)
            .pipe(foldOver, Effect.tap(Effect.logDebug('from cache')));

    const testRun: PT.Test.TestRunResults<I, O, T> = yield* cached && hasResults
        ? getFromCache()
        : getFromRun();

    return {testRun, previousTestRun};
});

export const diff = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>(
    config: AppConfigShape<I, O, T, E, R>,
) =>
    Command.make('diff', {exitOnDiff, cached}, ({exitOnDiff, cached}) =>
        Effect.gen(function* () {
            const {displayConfig} = config;
            const {testRun, previousTestRun} = yield* _diff({
                cached,
                config,
            });

            if (testRun.testCaseHashes.length === 0) {
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
                    count: testRun.testCaseHashes.length,
                });
            }
        }),
    );
