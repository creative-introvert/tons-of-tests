import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';

import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';
import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';

export type Config<I = unknown, O = unknown, T = unknown> = {
    testSuite: PT.Test.TestSuite<I, O, T>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
};

export const Config = P.Context.GenericTag<Config>('Config');

export const makeConfigLayer = (config: Config) =>
    P.Layer.sync(Config, () => Config.of(config));

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

const shouldRun = Options.boolean('run').pipe(Options.withDefault(false));

const createFilterLabel =
    (maybeLables: P.Option.Option<readonly PT.Classify.Label[]>) =>
    (tr: PT.Test.TestResult<unknown, unknown, unknown>) =>
        P.Option.match(maybeLables, {
            onNone: () => true,
            onSome: labels => labels.includes(tr.label),
        });

const getPreviousTestRunResults = <I = unknown, O = unknown, T = unknown>(
    testSuite: PT.Test.TestSuite<I, O, T>,
): P.Effect.Effect<
    P.Option.Option<PT.Test.TestRunResults>,
    SqlError | P.Result.ParseError,
    PT.TestRepository.TestRepository
> =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        return yield* repository.getPreviousTestRun(testSuite.name).pipe(
            P.Effect.flatMap(
                P.Option.match({
                    onNone: () => P.Effect.succeed(P.Option.none()),
                    onSome: testRun =>
                        repository
                            .getTestResultsStream(testRun)
                            .pipe(
                                PT.Test.runCollectRecord(testRun),
                                P.Effect.map(P.Option.some),
                            ),
                }),
            ),
        );
    });

export const _sumarize = <I = unknown, O = unknown, T = unknown>({
    labels,
    shouldRun,
    config: {testSuite, displayConfig},
}: {
    labels: P.Option.Option<readonly PT.Classify.Label[]>;
    shouldRun: boolean;
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* P.Effect.logDebug('repository');

        const filterLabel = createFilterLabel(labels);

        const currentTestRun = yield* repository.getOrCreateCurrentTestRun(
            testSuite.name,
        );
        yield* P.Effect.logDebug('currentTestRun');

        const hasResults = yield* repository.hasResults(currentTestRun);
        yield* P.Effect.logDebug('hasResults');

        const testRun: PT.Test.TestRunResults = yield* P.Effect.if(
            shouldRun || !hasResults,
            {
                onTrue: () =>
                    PT.Test.all(testSuite).pipe(
                        P.Effect.flatMap(
                            PT.Test.runCollectRecord(currentTestRun),
                        ),
                        P.Effect.tap(P.Effect.logDebug('from run')),
                    ),
                onFalse: () =>
                    repository
                        .getTestResultsStream(currentTestRun)
                        .pipe(
                            PT.Test.runCollectRecord(currentTestRun),
                            P.Effect.tap(P.Effect.logDebug('from cache')),
                        ),
            },
        );

        yield* P.Effect.logDebug('testRun');

        const previousTestRun = yield* getPreviousTestRunResults(testSuite);
        yield* P.Effect.logDebug('previousTestRun');
        return {testRun, previousTestRun};
    }).pipe(P.Effect.withLogSpan('summarize'));

const summarize = Command.make(
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
                    PT.Show.stats({testRun}),
                ].join('\n'),
            );
            console.timeLog('summarize', 'summarize');
            console.timeEnd('summarize');
        }),
);

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

const diff = Command.make(
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

export const _commit = <I = unknown, O = unknown, T = unknown>({
    config: {testSuite},
}: {
    config: Config<I, O, T>;
}) =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        yield* repository.commitCurrentTestRun({
            name: testSuite.name,
            hash: randomUUID(),
        });
        yield* P.Console.log(`Commited test run.`);
    });

const commit = Command.make('commit', {}, () =>
    P.Effect.gen(function* () {
        const config = yield* Config;
        yield* _commit({config});
    }),
);

const predictionTesting = Command.make('prediction-testing').pipe(
    Command.withSubcommands([summarize, diff, commit]),
);

const cli = Command.run(predictionTesting, {
    name: 'Prediction Testing',
    // FIXME
    version: 'v0.0.1',
});

export const main = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): void =>
    P.Effect.suspend(() => cli(process.argv)).pipe(
        P.Effect.provide(
            P.NodeContext.layer.pipe(
                P.Layer.merge(makeConfigLayer(config as Config)),
                P.Layer.provideMerge(PT.TestRepository.LiveLayer),
                P.Layer.provideMerge(
                    PT.TestRepository.makeSqliteLiveLayer(config.dbPath),
                ),
            ),
        ),
        P.NodeRuntime.runMain,
    );
