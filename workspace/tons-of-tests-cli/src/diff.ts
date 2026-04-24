import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Options} from '@effect/cli';
import {Chunk, Console, Effect, Option, Schema, Stream, pipe} from 'effect';

import {AppConfig, type AppConfigShape} from './Config.js';
import {cached, getPreviousTestRunResults} from './common.js';

// Raised when `diff --exit-on-diff` is set and the diff is non-empty.
// The CLI entry point translates this to process.exitCode = 1; programmatic
// consumers of `_diff` observe it as a typed failure in the Effect channel.
export class DiffNonEmpty extends Schema.TaggedError<DiffNonEmpty>()(
    'DiffNonEmpty',
    {count: Schema.Int},
) {}

const exitOnDiff = Options.boolean('exit-on-diff').pipe(
    Options.withDescription(
        'Will exit with non-zero status if there are differences',
    ),
);

export const _diff = <I = unknown, O = unknown, T = unknown>({
    cached,
    config: {testSuite, concurrency},
}: {
    cached: boolean;
    config: AppConfigShape<I, O, T>;
}) =>
    Effect.gen(function* () {
        const tests = yield* PT.TestRepository.TestRepository;

        const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        const hasResults = yield* tests.hasResults(currentTestRun);

        const previousTestRun = yield* getPreviousTestRunResults(testSuite);

        const shouldInclude = (next: PT.Test.TestResult<I, O, T>): boolean =>
            previousTestRun.pipe(
                Option.flatMap(_ =>
                    Option.fromNullable(
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

        // Stats reflect the filtered (visible) entries because the filter is
        // pushed in front of the fold. See plan Open Questions — pre-refactor
        // code returned full-run stats on a filtered record, which was
        // arguably a bug.
        const foldOver = <E, R>(
            src$: Stream.Stream<PT.Test.TestResult<I, O, T>, E, R>,
        ) =>
            src$.pipe(
                Stream.filter(shouldInclude),
                PT.Test.runCollectRecord(currentTestRun),
            );

        const getFromRun = (): Effect.Effect<
            PT.Test.TestRunResults<I, O, T>,
            PT.Error.RepositoryError,
            PT.TestRepository.TestRepository
        > =>
            pipe(
                PT.Test.all(testSuite, {concurrency}),
                Stream.grouped(50),
                Stream.tap(group =>
                    tests.insertTestResults(
                        Chunk.toReadonlyArray(group),
                        currentTestRun,
                    ),
                ),
                Stream.flattenChunks,
                foldOver,
                Effect.tap(Effect.logDebug('from run')),
            );

        const getFromCache = (): Effect.Effect<
            PT.Test.TestRunResults<I, O, T>,
            PT.Error.RepositoryError,
            PT.TestRepository.TestRepository
        > =>
            tests
                .getTestResultsStream<I, O, T>(
                    currentTestRun,
                    testSuite.schemas,
                )
                .pipe(foldOver, Effect.tap(Effect.logDebug('from cache')));

        const testRun: PT.Test.TestRunResults<I, O, T> =
            yield* (cached && hasResults ? getFromCache() : getFromRun());

        return {testRun, previousTestRun};
    });

export const diff = Command.make(
    'diff',
    {exitOnDiff, cached},
    ({exitOnDiff, cached}) =>
        Effect.gen(function* () {
            const config = yield* AppConfig;
            const {testSuite, displayConfig} = config;
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
                yield* Effect.fail(
                    new DiffNonEmpty({count: testRun.testCaseHashes.length}),
                );
            }
        }),
);
