import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';

import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';
import {Config} from './Config.js';
import {getPreviousTestRunResults, shouldRun} from './common.js';

const exitOnDiff = Options.boolean('exit-on-diff').pipe(
    Options.withDescription(
        'Will exit with non-zero status if there are differences',
    ),
);

export const _diff = <I = unknown, O = unknown, T = unknown>({
    shouldRun,
    config: {testSuite},
}: {
    shouldRun: boolean;
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;

        const currentTestRun = yield* repository.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        const hasResults = yield* repository.hasResults(currentTestRun);

        // FIXME: void type cast
        const previousTestRun = (yield* getPreviousTestRunResults(
            testSuite,
        )) as P.Option.Option<PT.Test.TestRunResults<I, O, T>>;

        // FIXME: I can't filter before runCollectRecord, as
        // I need to calculate the stats first. Not sure how
        // to do this better.
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

        const getFromRun: P.Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | P.Result.ParseError | ResultLengthMismatch,
            PT.TestRepository.TestRepository
        > = P.pipe(
            PT.Test.all(testSuite),
            P.Effect.flatMap(PT.Test.runCollectRecord(currentTestRun)),
            P.Effect.map(filterUnchanged(previousTestRun)),
        );
        const getFromCache: P.Effect.Effect<
            PT.Test.TestRunResults,
            SqlError | P.Result.ParseError,
            PT.TestRepository.TestRepository
        > = repository
            .getTestResultsStream(currentTestRun)
            .pipe(
                PT.Test.runCollectRecord(currentTestRun),
                P.Effect.map(filterUnchanged(previousTestRun)),
            );

        const testRun: PT.Test.TestRunResults = yield* P.Effect.if({
            onTrue: () => getFromRun,
            onFalse: () => getFromCache,
        })(shouldRun || !hasResults);

        return {testRun, previousTestRun};
    });

export const diff = Command.make(
    'diff',
    {exitOnDiff, shouldRun},
    ({exitOnDiff, shouldRun}) =>
        P.Effect.gen(function* () {
            const config = yield* Config;
            const {testSuite, displayConfig} = config;
            const {testRun, previousTestRun} = yield* _diff({
                shouldRun,
                config,
            });

            if (testRun.testCaseHashes.length === 0) {
                yield* P.Console.log('Nothing to show.');
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
