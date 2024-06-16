import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import * as P from './prelude.js';
import {Config} from './Config.js';
import {getPreviousTestRunResults, cached} from './common.js';
import {isNotUndefined} from 'effect/Predicate';

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
    P.Effect.gen(function* () {
        const tests = yield* PT.TestRepository.TestRepository;

        const currentTestRun = yield* tests.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        const hasResults = yield* tests.hasResults(currentTestRun);

        const previousTestRun: P.Option.Option<
            PT.Test.TestRunResults<unknown, unknown, unknown>
        > = yield* getPreviousTestRunResults(testSuite);

        const filterUnchanged =
            (previous: P.Option.Option<PT.Test.TestRunResults>) =>
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
                        P.Option.flatMap(_ =>
                            P.Option.fromNullable(
                                _.testResultsByTestCaseHash[hash],
                            ),
                        ),
                        P.Option.map(
                            prev =>
                                prev.label !== next.label ||
                                !PT.Classify.defaultIsEqual(
                                    next.result,
                                    prev.result,
                                ),
                        ),
                        P.Option.getOrElse(() => true),
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

        const getFromRun = (): P.Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | P.Result.ParseError | ResultLengthMismatch,
            PT.TestRepository.TestRepository
        > =>
            P.pipe(
                PT.Test.all(testSuite, {concurrency}),
                P.Stream.tap(_ => tests.insertTestResult(_, testSuite.name)),
                P.Stream.catchTag('DuplicateTestResult', e => {
                    console.warn('Duplicate test result', {
                        input: e.input,
                        expected: e.expected,
                    });
                    return P.Stream.succeed(undefined);
                }),
                P.Stream.filter(isNotUndefined),
                PT.Test.runCollectRecord(currentTestRun),
                P.Effect.tap(P.Effect.logDebug('from run')),
                P.Effect.map(filterUnchanged(previousTestRun)),
            );

        const getFromCache = (): P.Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | P.Result.ParseError,
            PT.TestRepository.TestRepository
        > =>
            tests
                .getTestResultsStream(currentTestRun)
                .pipe(
                    PT.Test.runCollectRecord(currentTestRun),
                    P.Effect.tap(P.Effect.logDebug('from cache')),
                    P.Effect.map(filterUnchanged(previousTestRun)),
                );

        const testRun: PT.Test.TestRunResults = yield* P.Effect.if(
            cached && hasResults,
            {onTrue: getFromCache, onFalse: getFromRun},
        );

        return {testRun, previousTestRun};
    });

export const diff = Command.make(
    'diff',
    {exitOnDiff, cached},
    ({exitOnDiff, cached}) =>
        P.Effect.gen(function* () {
            const config = yield* Config;
            const {testSuite, displayConfig} = config;
            const {testRun, previousTestRun} = yield* _diff({
                cached,
                config,
            });

            if (testRun.testCaseHashes.length === 0) {
                yield* P.Console.log(
                    [
                        '┌─────────────────────────┐',
                        '│ NO TEST RESULTS VISIBLE │',
                        '└─────────────────────────┘',
                    ].join('\n'),
                );
                return;
            }

            yield* P.Console.log(
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
                yield* P.Effect.die('Non-empty diff.');
            }
        }),
);
