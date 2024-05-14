import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';

import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import * as P from './prelude.js';
import {Config} from './Config.js';
import {getPreviousTestRunResults, shouldRun} from './common.js';

const LabelSchema = P.Schema.transform(
    P.Schema.String,
    P.Schema.Array(PT.Classify.LabelSchema),
    {
        decode: s => s.split(',') as readonly PT.Classify.Label[],
        encode: xs => xs.join(','),
    },
);

const labels = Options.text('labels').pipe(
    Options.withSchema(LabelSchema),
    Options.optional,
);

const createFilterLabel =
    (maybeLables: P.Option.Option<readonly PT.Classify.Label[]>) =>
    (tr: PT.Test.TestResult<unknown, unknown, unknown>) =>
        P.Option.match(maybeLables, {
            onNone: () => true,
            onSome: labels => labels.includes(tr.label),
        });

export const _sumarize = <I = unknown, O = unknown, T = unknown>({
    labels: maybeLabels,
    shouldRun,
    config: {testSuite, displayConfig, concurrency},
}: {
    labels: P.Option.Option<readonly PT.Classify.Label[]>;
    shouldRun: boolean;
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* P.Effect.logDebug('repository');

        const filterLabels = (
            args: PT.Test.TestRunResults,
        ): PT.Test.TestRunResults =>
            maybeLabels.pipe(
                P.Option.match({
                    onSome: labels => {
                        const {
                            testCaseHashes,
                            testResultsByTestCaseHash,
                            ...rest
                        } = args;
                        const _testCaseHashes: string[] = [];
                        const _testResultsByTestCaseHash: PT.Test.TestRunResults['testResultsByTestCaseHash'] =
                            {};

                        for (const hash of testCaseHashes) {
                            const next = testResultsByTestCaseHash[hash];
                            if (labels.includes(next.label)) {
                                _testCaseHashes.push(hash);
                                _testResultsByTestCaseHash[hash] = next;
                            }
                        }

                        return {
                            testCaseHashes: _testCaseHashes,
                            testResultsByTestCaseHash:
                                _testResultsByTestCaseHash,
                            ...rest,
                        };
                    },
                    onNone: () => args,
                }),
            );

        const currentTestRun = yield* repository.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        yield* P.Effect.logDebug('currentTestRun');

        const hasResults = yield* repository.hasResults(currentTestRun);
        yield* P.Effect.logDebug('hasResults');

        const getFromRun = () =>
            PT.Test.all(testSuite, {
                concurrency: concurrency || 1,
            }).pipe(
                P.Effect.flatMap(PT.Test.runCollectRecord(currentTestRun)),
                P.Effect.tap(P.Effect.logDebug('from run')),
            );

        const getFromCache = () =>
            repository
                .getTestResultsStream(currentTestRun)
                .pipe(
                    PT.Test.runCollectRecord(currentTestRun),
                    P.Effect.tap(P.Effect.logDebug('from cache')),
                );

        const testRun: PT.Test.TestRunResults = yield* P.Effect.if(
            shouldRun || !hasResults,
            {onTrue: getFromRun, onFalse: getFromCache},
        ).pipe(P.Effect.map(filterLabels));

        yield* P.Effect.logDebug('testRun');

        const previousTestRun = (yield* getPreviousTestRunResults(
            testSuite,
        )) as P.Option.Option<PT.Test.TestRunResults<I, O, T>>;

        yield* P.Effect.logDebug('previousTestRun');
        return {testRun, previousTestRun};
    }).pipe(P.Effect.withLogSpan('summarize'));

export const summarize = Command.make(
    'summarize',
    {labels, shouldRun},
    ({labels, shouldRun}) =>
        P.Effect.gen(function* () {
            const config = yield* Config;
            const {testSuite, displayConfig, dbPath} = config;
            const {testRun, previousTestRun} = yield* _sumarize({
                labels,
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
                    PT.Show.stats({testRun}),
                ].join('\n'),
            );
        }),
);
