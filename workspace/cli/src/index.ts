import {isDeepStrictEqual} from 'node:util';

import {Command, Options} from '@effect/cli';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';

export type Config<I = unknown, O = unknown, T = unknown> = {
    testSuite: PT.Test.TestSuite<I, O, T>;
    dirPath: string;
    filePostfix: string;
    testSuiteName: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
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
    (tr: PT.Test.TestResult<unknown, unknown, unknown>) =>
        P.O.match(maybeLables, {
            onNone: () => true,
            onSome: labels => labels.includes(tr.label),
        });

const TestRunSchema = P.Schema.parseJson(PT.Test.TestRunSchema);

const readPreviousTestRun = P.E.gen(function* () {
    const {testSuiteName, dirPath, filePostfix} = yield* Config;
    const fs = yield* P.FS.FileSystem;
    return yield* fs
        .readFileString(`${dirPath}/${testSuiteName}.${filePostfix}.json`)
        .pipe(P.E.flatMap(P.Schema.decodeUnknown(TestRunSchema)), P.E.option);
});

const summarize = Command.make('summarize', {labels}, ({labels}) =>
    P.E.gen(function* () {
        const {
            testSuite,
            isResultNil,
            showInput,
            showExpected,
            showResult,
            displayConfig,
        } = yield* Config;

        const filterLabel = createFilterLabel(labels);
        const previousTestRun = yield* readPreviousTestRun;
        const testRun = yield* PT.Test.all(testSuite).pipe(
            P.Stream.filter(filterLabel),
            PT.Test.runFoldEffect,
        );

        if (testRun.testResultIds.length === 0) {
            yield* P.Console.log('Nothing to show.');
            return;
        }

        yield* P.Console.log(
            [
                PT.Show.summarize({
                    testRun,
                    previousTestRun,
                    // isResultNil,
                    // showInput,
                    // showExpected,
                    // showResult,
                    displayConfig,
                }),
                '',
                PT.Show.stats({testRun}),
            ].join('\n'),
        );
    }),
);

const ci = Options.boolean('ci').pipe(
    Options.withDescription(
        'Will exit with non-zero status if there are differences',
    ),
);

const diff = Command.make('diff', {ci}, ({ci}) =>
    P.E.gen(function* () {
        const {
            testSuite,
            isResultNil,
            showInput,
            showExpected,
            showResult,
            displayConfig,
        } = yield* Config;

        const previousTestRun = yield* readPreviousTestRun;

        const testRun = yield* PT.Test.all(testSuite).pipe(
            P.Stream.filter(next =>
                P.pipe(
                    P.O.flatMap(previousTestRun, prevTestRun =>
                        P.O.fromNullable(prevTestRun.testResultsById[next.id]),
                    ),
                    P.O.map(
                        prev =>
                            prev.label !== next.label ||
                            !isDeepStrictEqual(prev.result, next.result),
                    ),
                    P.O.getOrElse(() => true),
                ),
            ),
            PT.Test.runFoldEffect,
        );

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
        if (ci) {
            yield* P.E.die('Non-empty diff.');
        }
    }),
);

// FIXME: Either sqlite backend, csv, or use line-delimited JSON.
const write = Command.make('write', {}, () =>
    P.E.gen(function* () {
        const {testSuite, dirPath, testSuiteName, filePostfix} = yield* Config;
        const fs = yield* P.FS.FileSystem;

        yield* fs.makeDirectory(dirPath, {recursive: true});

        const testRun = yield* PT.Test.all(testSuite).pipe(
            PT.Test.runFoldEffect,
        );
        const filePath = `${dirPath}/${testSuiteName}.${filePostfix}.json`;
        yield* fs.writeFileString(filePath, JSON.stringify(testRun, null, 2));
        yield* P.Console.log(`Wrote to "${filePath}"`);
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
