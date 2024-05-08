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
    config: {testSuite, displayConfig},
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

        // FIXME: provide schema to config for tests, to get I, O and T
        const previousTestRun = (yield* getPreviousTestRunResults(
            testSuite,
        )) as P.Option.Option<PT.Test.TestRunResults<I, O, T>>;

        const filter = (next: PT.Test.TestResult<I, O, T>): boolean =>
            P.pipe(
                P.Option.flatMap(previousTestRun, prevTestRun =>
                    P.Option.fromNullable(
                        prevTestRun.testResultsById[next.hash],
                    ),
                ),
                P.Option.map(
                    prev =>
                        prev.label !== next.label ||
                        !isDeepStrictEqual(prev.result, next.result),
                ),
                P.Option.getOrElse(() => true),
            );

        const getFromRun: P.Effect.Effect<
            PT.Test.TestRunResults<I, O, T>,
            SqlError | P.Result.ParseError | ResultLengthMismatch,
            PT.TestRepository.TestRepository
        > = P.pipe(
            PT.Test.all(testSuite),
            P.Effect.flatMap(testResults$ =>
                P.Stream.filter(testResults$, filter).pipe(
                    PT.Test.runCollectRecord(currentTestRun),
                ),
            ),
        );
        const getFromCache: P.Effect.Effect<
            PT.Test.TestRunResults<I, O, T>,
            SqlError | P.Result.ParseError,
            PT.TestRepository.TestRepository
        > = repository
            .getTestResultsStream(currentTestRun)
            .pipe(
                a =>
                    a as P.Stream.Stream<
                        PT.Test.TestResult<I, O, T>,
                        SqlError | P.Result.ParseError,
                        never
                    >,
                P.Stream.filter(filter),
                PT.Test.runCollectRecord(currentTestRun),
            );

        const testRun = yield* P.Effect.if(shouldRun || !hasResults, {
            onTrue: () => getFromRun,
            onFalse: () => getFromCache,
        });

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

            if (testRun.testResultIds.length === 0) {
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
