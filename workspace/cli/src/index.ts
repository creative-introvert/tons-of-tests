import {isDeepStrictEqual} from 'node:util';

import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';
import type {DisplayConfig} from 'workspace/core/src/Show.js';

import * as P from './prelude.js';

export type Config<I = unknown, O = unknown, T = unknown> = {
    testSuite: PT.TestSuite<I, O, T>;
    dirPath: string;
    filePostfix: string;
    testSuiteName: string;
    displayConfig?: Partial<DisplayConfig> | undefined;
    showInput?: undefined | ((input: I) => string);
    showExpected?: undefined | ((expected: T) => string);
    showResult?: undefined | ((result: O, expected: T) => string);
    isResultNil?: undefined | ((result: O) => boolean);
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

const createFilterLabel =
    (maybeLables: P.O.Option<readonly PT.Classify.Label[]>) =>
    (tr: PT.TestResult<unknown, unknown, unknown>) =>
        P.O.match(maybeLables, {
            onNone: () => true,
            onSome: labels => labels.includes(tr.label),
        });

const TestRunSchema = P.Schema.parseJson(PT.TestRunSchema);

const readPreviousTestRun = P.E.gen(function* (_) {
    const {testSuiteName, dirPath, filePostfix} = yield* _(Config);
    const fs = yield* _(P.FS.FileSystem);
    return yield* _(
        fs.readFileString(`${dirPath}/${testSuiteName}.${filePostfix}.json`),
        P.E.flatMap(P.Schema.decodeUnknown(TestRunSchema)),
        P.E.option,
    );
});

const summarize = Command.make('summarize', {labels}, ({labels}) =>
    P.E.gen(function* (_) {
        const {
            testSuite,
            isResultNil,
            showInput,
            showExpected,
            showResult,
            displayConfig,
        } = yield* _(Config);

        const filterLabel = createFilterLabel(labels);
        const previousTestRun = yield* _(readPreviousTestRun);
        const testRun = yield* _(
            PT.testAll(testSuite).pipe(
                P.Stream.filter(filterLabel),
                PT.runFoldEffect,
            ),
        );

        if (testRun.testResultIds.length === 0) {
            yield* _(P.Console.log('Nothing to show.'));
            return;
        }

        yield* _(
            P.Console.log(
                [
                    PT.Show.summary({
                        testRun,
                        previousTestRun,
                        isResultNil,
                        showInput,
                        showExpected,
                        showResult,
                        displayConfig,
                    }),
                    '',
                    PT.Show.stats({testRun}),
                ].join('\n'),
            ),
        );
    }),
);

const ci = Options.boolean('ci').pipe(
    Options.withDescription(
        'Will exit with non-zero status if there are differences',
    ),
);

const diff = Command.make('diff', {ci}, ({ci}) =>
    P.E.gen(function* (_) {
        const {
            testSuite,
            isResultNil,
            showInput,
            showExpected,
            showResult,
            displayConfig,
        } = yield* _(Config);

        const previousTestRun = yield* _(readPreviousTestRun);

        const testRun = yield* _(
            PT.testAll(testSuite).pipe(
                P.Stream.filter(next =>
                    P.pipe(
                        P.O.flatMap(previousTestRun, prevTestRun =>
                            P.O.fromNullable(
                                prevTestRun.testResultsById[next.id],
                            ),
                        ),
                        P.O.map(
                            prev =>
                                prev.label !== next.label ||
                                !isDeepStrictEqual(prev.result, next.result),
                        ),
                        P.O.getOrElse(() => true),
                    ),
                ),
                PT.runFoldEffect,
            ),
        );

        if (testRun.testResultIds.length === 0) {
            yield* _(P.Console.log('Nothing to show.'));
            return;
        }

        yield* _(
            P.Console.log(
                [
                    PT.Show.summary({
                        testRun,
                        previousTestRun,
                        isResultNil,
                        showInput,
                        showExpected,
                        showResult,
                        displayConfig,
                    }),
                    '',
                    PT.Show.diff({
                        testRun,
                        diff: PT.diff({testRun, previousTestRun}),
                    }),
                ].join('\n'),
            ),
        );
        if (ci) {
            yield* _(P.E.die('Non-empty diff.'));
        }
    }),
);

// FIXME: Either sqlite backend, csv, or use line-delimited JSON.
const write = Command.make('write', {}, () =>
    P.E.gen(function* (_) {
        const {testSuite, dirPath, testSuiteName, filePostfix} =
            yield* _(Config);
        const fs = yield* _(P.FS.FileSystem);

        yield* _(fs.makeDirectory(dirPath, {recursive: true}));

        const testRun = yield* _(PT.testAll(testSuite).pipe(PT.runFoldEffect));
        const filePath = `${dirPath}/${testSuiteName}.${filePostfix}.json`;
        yield* _(
            fs.writeFileString(filePath, JSON.stringify(testRun, null, 2)),
        );
        yield* _(P.Console.log(`Wrote to "${filePath}"`));
    }),
);

const predictionTesting = Command.make('prediction-testing').pipe(
    Command.withSubcommands([summarize, write, diff]),
);

const cli = Command.run(predictionTesting, {
    name: 'Prediction Testing',
    // FIXME
    version: 'v0.0.1',
});

export const run = <I = unknown, O = unknown, T = unknown>(
    config: Config<I, O, T>,
): void =>
    P.E.suspend(() => cli(process.argv)).pipe(
        P.E.provide(
            P.NodeContext.layer.pipe(
                P.Layer.merge(makeConfigLayer(config as Config)),
            ),
        ),
        P.NodeRuntime.runMain,
    );
