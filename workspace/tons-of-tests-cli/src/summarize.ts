import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import * as P from './prelude.js';
import {Config} from './Config.js';
import {getPreviousTestRunResults, shouldRun} from './common.js';

const LabelSchema = P.Schema.transform(
    P.Schema.String,
    P.Schema.Array(
        P.Schema.String.pipe(P.Schema.compose(PT.Classify.LabelSchema)),
    ),
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

const TagsSchema = P.Schema.transform(
    P.Schema.String,
    P.Schema.Array(P.Schema.String),
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

export const _sumarize = <I = unknown, O = unknown, T = unknown>({
    labels: maybeLabels,
    orTags: maybeOrTags,
    andTags: maybeAndTags,
    shouldRun,
    config: {testSuite, displayConfig, concurrency},
}: {
    labels: P.Option.Option<readonly PT.Classify.Label[]>;
    orTags: P.Option.Option<readonly string[]>;
    andTags: P.Option.Option<readonly string[]>;
    shouldRun: boolean;
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* P.Effect.logDebug('repository');

        const hasLabel = (label: PT.Classify.Label) =>
            P.Option.isNone(maybeLabels) || maybeLabels.value.includes(label);

        const hasOrTags = (tags: readonly string[]) =>
            P.Option.isNone(maybeOrTags) ||
            tags.some(tag => maybeOrTags.value.includes(tag));

        const hasAndTags = (tags: readonly string[]) =>
            P.Option.isNone(maybeAndTags) ||
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
        ).pipe(P.Effect.map(filter));

        yield* P.Effect.logDebug('testRun');

        const previousTestRun = (yield* getPreviousTestRunResults(
            testSuite,
        )) as P.Option.Option<PT.Test.TestRunResults<I, O, T>>;

        yield* P.Effect.logDebug('previousTestRun');
        return {testRun, previousTestRun};
    }).pipe(P.Effect.withLogSpan('summarize'));

export const summarize = Command.make(
    'summarize',
    {labels, shouldRun, orTags, andTags},
    ({labels, shouldRun, orTags, andTags}) =>
        P.Effect.gen(function* () {
            const config = yield* Config;
            const {testSuite, displayConfig, dbPath} = config;
            const {testRun, previousTestRun} = yield* _sumarize({
                labels,
                orTags,
                andTags,
                shouldRun,
                config,
            });

            if (testRun.testCaseHashes.length === 0) {
                yield* P.Console.log(
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
