import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Options} from '@effect/cli';
import type {ResultLengthMismatch, SqlError} from '@effect/sql/SqlError';
import {Console, Effect, Option, pipe, Stream} from 'effect';
import type {ParseError} from 'effect/ParseResult';

import {cached, getPreviousTestRunResults} from './common.js';
import {Config} from './Config.js';

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
    config: Config<I, O, T>;
}) =>
    Effect.gen(function* () {
        const tests = yield* PT.TestRepository.TestRepository;

        const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        const hasResults = yield* tests.hasResults(currentTestRun);

        const previousTestRun: Option.Option<
            PT.Test.TestRunResults<unknown, unknown, unknown>
        > = yield* getPreviousTestRunResults(testSuite);

        const filterUnchanged =
            (previous: Option.Option<PT.Test.TestRunResults>) =>
            ({
                testCaseHashes,
                testResultsByTestCaseHash,
                ...rest
            }: PT.Test.TestRunResults): PT.Test.TestRunResults => {
                const _testCaseHashes = [];
                const _testResultsByTestCaseHash: PT.Test.TestRunResults['testResultsByTestCaseHash'] =
                    {};

                for (const hash of testCaseHashes) {
                    const next = testResultsByTestCaseHash[hash];

                    const shouldInclude = previous.pipe(
                        Option.flatMap(_ =>
                            Option.fromNullable(
                                _.testResultsByTestCaseHash[hash],
                            ),
                        ),
                        Option.map(
                            prev =>
                                prev.label !== next.label ||
                                !PT.Classify.defaultIsEqual(
                                    next.result,
                                    prev.result,
                                ),
                        ),
                        Option.getOrElse(() => true),
                    );

                    if (shouldInclude) {
                        _testCaseHashes.push(hash);
                        _testResultsByTestCaseHash[hash] = next;
                    }
                }

                return {
                    testCaseHashes: _testCaseHashes,
                    testResultsByTestCaseHash: _testResultsByTestCaseHash,
                    ...rest,
                };
            };

        const getFromRun = (): Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | ParseError | ResultLengthMismatch,
            PT.TestRepository.TestRepository
        > =>
            pipe(
                PT.Test.all(testSuite, {concurrency}),
                Stream.tap(_ => tests.insertTestResult(_, testSuite.name)),
                PT.Test.runCollectRecord(currentTestRun),
                Effect.tap(Effect.logDebug('from run')),
                Effect.map(filterUnchanged(previousTestRun)),
            );

        const getFromCache = (): Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | ParseError,
            PT.TestRepository.TestRepository
        > =>
            tests
                .getTestResultsStream(currentTestRun)
                .pipe(
                    PT.Test.runCollectRecord(currentTestRun),
                    Effect.tap(Effect.logDebug('from cache')),
                    Effect.map(filterUnchanged(previousTestRun)),
                );

        const testRun: PT.Test.TestRunResults = yield* Effect.if(
            cached && hasResults,
            {onTrue: getFromCache, onFalse: getFromRun},
        );

        return {testRun, previousTestRun};
    });

export const diff = Command.make(
    'diff',
    {exitOnDiff, cached},
    ({exitOnDiff, cached}) =>
        Effect.gen(function* () {
            const config = yield* Config;
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
                yield* Effect.die('Non-empty diff.');
            }
        }),
);
