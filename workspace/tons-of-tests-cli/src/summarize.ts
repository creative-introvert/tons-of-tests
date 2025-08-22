import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Options} from '@effect/cli';
import {Console, Effect, Option, Schema, Stream} from 'effect';

import {Config} from './Config.js';
import {cached, getPreviousTestRunResults} from './common.js';

const LabelSchema = Schema.transform(
    Schema.String,
    Schema.Array(Schema.String.pipe(Schema.compose(PT.Classify.LabelSchema))),
    {
        decode: s => s.split(','),
        encode: xs => xs.join(','),
    },
);

const labels = Options.text('labels').pipe(
    Options.withSchema(LabelSchema),
    Options.optional,
    Options.withDescription('Filter labels (OR).'),
);

const TagsSchema = Schema.transform(
    Schema.String,
    Schema.Array(Schema.String),
    {
        decode: s => (s.length === 0 ? [] : s.split(',')),
        encode: xs => xs.join(','),
    },
);

const orTags = Options.text('tags').pipe(
    Options.withSchema(TagsSchema),
    Options.optional,
    Options.withDescription('Filter tags (OR).'),
);

const andTags = Options.text('all-tags').pipe(
    Options.withSchema(TagsSchema),
    Options.optional,
    Options.withDescription('Filter tags (AND).'),
);

// TEST: summarize --labels doesn't affect the db (i.e. same test results are stored)
// TEST: summarize --run -> commit -> summarize --run is idempotent
export const _sumarize = <I = unknown, O = unknown, T = unknown>({
    labels: maybeLabels,
    orTags: maybeOrTags,
    andTags: maybeAndTags,
    cached,
    config: {testSuite, displayConfig, concurrency},
}: {
    labels: Option.Option<readonly PT.Classify.Label[]>;
    orTags: Option.Option<readonly string[]>;
    andTags: Option.Option<readonly string[]>;
    cached: boolean;
    config: Config<I, O, T>;
}) =>
    Effect.gen(function* () {
        const tests = yield* PT.TestRepository.TestRepository;
        yield* Effect.logDebug('repository');

        const hasLabel = (label: PT.Classify.Label) =>
            Option.isNone(maybeLabels) || maybeLabels.value.includes(label);

        const hasOrTags = (tags: readonly string[]) =>
            Option.isNone(maybeOrTags) ||
            tags.some(tag => maybeOrTags.value.includes(tag));

        const hasAndTags = (tags: readonly string[]) =>
            Option.isNone(maybeAndTags) ||
            maybeAndTags.value.every(tag => tags.includes(tag));

        const filter = (
            args: PT.Test.TestRunResults,
        ): PT.Test.TestRunResults => {
            const {testCaseHashes, testResultsByTestCaseHash, ...rest} = args;
            const _testCaseHashes: string[] = [];
            const _testResultsByTestCaseHash: PT.Test.TestRunResults['testResultsByTestCaseHash'] =
                {};

            for (const hash of testCaseHashes) {
                const next = testResultsByTestCaseHash[hash];
                if (
                    hasLabel(next.label) &&
                    hasOrTags(next.tags) &&
                    hasAndTags(next.tags)
                ) {
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
                        Stream.tap(_ =>
                            tests.insertTestResult(_, testSuite.name),
                        ),
                        PT.Test.runCollectRecord(currentTestRun),
                        Effect.tap(Effect.logDebug('from run')),
                        Effect.map(filter),
                    ),
                ),
            );

        const getFromCache = () =>
            tests
                .getTestResultsStream(currentTestRun)
                .pipe(
                    PT.Test.runCollectRecord(currentTestRun),
                    Effect.tap(Effect.logDebug('from cache')),
                    Effect.map(filter),
                );

        const testRun: PT.Test.TestRunResults = yield* Effect.if(
            cached && hasResults,
            {onTrue: getFromCache, onFalse: getFromRun},
        );

        yield* Effect.logDebug('testRun');

        const previousTestRun = (yield* getPreviousTestRunResults(
            testSuite,
        )) as Option.Option<PT.Test.TestRunResults<I, O, T>>;

        yield* Effect.logDebug('previousTestRun');
        return {testRun, previousTestRun};
    }).pipe(Effect.withLogSpan('summarize'));

export const summarize = Command.make(
    'summarize',
    {labels, cached, orTags, andTags},
    ({labels, cached, orTags, andTags}) =>
        Effect.gen(function* () {
            const config = yield* Config;
            const {displayConfig} = config;
            const {testRun, previousTestRun} = yield* _sumarize({
                labels,
                orTags,
                andTags,
                cached,
                config,
            });

            if (testRun.testCaseHashes.length === 0) {
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
