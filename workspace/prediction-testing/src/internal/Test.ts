import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import type {ResultLengthMismatch, SqlError} from '@effect/sql/Error';

import * as P from '../prelude.js';
import type {Classify, Label} from '../Classify.js';
import {
    LabelSchema,
    Stats,
    defaultIsNil,
    makeClassify,
    precision,
    recall,
} from './Classify.js';
import type {
    Program,
    TestCase,
    TestSuite,
    TestResult,
    TestRunResults,
    Diff,
} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {TestRepository} from './Test.repository.sqlite.js';

export const makeSha256 = <I>(input: I): string => {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
};

const TestResult = {
    make: <I, O, T>(args: Omit<TestResult<I, O, T>, 'hash'>) => ({
        ...args,
        hash: makeSha256(args.input),
    }),
};

export const TestResultSchema: P.Schema.Schema<TestResult> = P.Schema.Struct({
    hash: P.Schema.String,
    input: P.Schema.Unknown,
    result: P.Schema.Unknown,
    expected: P.Schema.Unknown,
    label: LabelSchema,
    tags: P.Schema.Array(P.Schema.String),
});

const TestRunResults = {
    emptyFromTestRun: <I, O, T>(args: TestRun): TestRunResults<I, O, T> => ({
        ...args,
        testResultsById: {},
        testResultIds: [],
        stats: Stats.empty(),
    }),
};

export const test = <I, O, T>({
    testCase: {input, expected, tags},
    program,
    classify,
}: {
    testCase: TestCase<I, T>;
    program: Program<I, O>;
    classify: Classify<O, T>;
}): P.Effect.Effect<TestResult<I, O, T>> => {
    return program(input).pipe(
        P.Effect.map(result =>
            TestResult.make({
                input,
                result,
                expected,
                tags: tags ?? [],
                label: classify(result, expected),
            }),
        ),
    );
};

export const all = <I, O, T>({
    testCases,
    program,
    classify = makeClassify(isDeepStrictEqual, defaultIsNil, defaultIsNil),
    name,
}: TestSuite<I, O, T>) =>
    P.Effect.gen(function* () {
        const repository = yield* TestRepository;
        const currentTestRun =
            yield* repository.getOrCreateCurrentTestRun(name);
        yield* repository.clearTestRun(currentTestRun);

        return P.Stream.fromIterable(testCases).pipe(
            P.Stream.mapEffect(testCase => test({testCase, program, classify})),
            P.Stream.tap(testResult =>
                repository.insertTestResult(testResult, name),
            ),
        );
    });

export const runCollectRecord =
    (testRun: TestRun) =>
    <I, O, T, E>(
        testResults$: P.Stream.Stream<TestResult<I, O, T>, E, TestRepository>,
    ): P.Effect.Effect<TestRunResults<I, O, T>, E, TestRepository> =>
        testResults$.pipe(
            P.Stream.runFoldEffect(
                TestRunResults.emptyFromTestRun<I, O, T>(testRun),
                (run, result) =>
                    P.Effect.gen(function* () {
                        if (run.testResultsById[result.hash] !== undefined) {
                            yield* P.Console.warn(
                                `Skipped duplicate test case. hash=${result.hash}`,
                            );
                            return run;
                        } else {
                            run.testResultsById[result.hash] = result;
                            run.testResultIds.push(result.hash);
                            run.stats[result.label]++;
                        }

                        return run;
                    }),
            ),
            P.Effect.map(run => {
                run.stats.precision = precision(run.stats);
                run.stats.recall = recall(run.stats);
                return run;
            }),
        );

// export type TestResultPredicate<I, O, T> = (args: {
//     testResult: _TestResult<I, O, T>;
//     previousTestResult: P.Option.Option<_TestResult<I, O, T>>;
// }) => boolean;

/** Filters results. Note, tests still run, but results are filtered out. */
// export const filterTestRun: {
//     <I, O, T>(
//         predicates: TestResultPredicate<I, O, T>[],
//     ): (args: {
//         testRun: _TestRun<I, O, T>;
//         previousTestRun: P.Option.Option<_TestRun<I, O, T>>;
//     }) => _TestRun<I, O, T>;
//     <I, O, T>(
//         args: {
//             testRun: _TestRun<I, O, T>;
//             previousTestRun: P.Option.Option<_TestRun<I, O, T>>;
//         },
//         predicates: TestResultPredicate<I, O, T>[],
//     ): _TestRun<I, O, T>;
// } = P.dual(
//     2,
//     <I, O, T>(
//         {
//             testRun,
//             previousTestRun,
//         }: {
//             testRun: _TestRun<I, O, T>;
//             previousTestRun: P.Option.Option<_TestRun<I, O, T>>;
//         },
//         predicates: TestResultPredicate<I, O, T>[],
//     ) =>
//         P.pipe(
//             testRun.testResultIds.reduce((m, id) => {
//                 const testResult = testRun.testResultsById[id];
//                 const previousTestResult = previousTestRun.pipe(
//                     P.Option.map(_ => _.testResultsById[id]),
//                 );
//                 const isMatch = predicates.every(p =>
//                     p({testResult, previousTestResult}),
//                 );
//
//                 if (isMatch) {
//                     if (m.testResultsById[id] === undefined) {
//                         m.testResultsById[id] = {} as TestResult<I, O, T>;
//                     }
//                     m.testResultsById[id] = testResult;
//                     m.testResultIds.push(id);
//                     m.stats[testResult.label]++;
//                 }
//
//                 return m;
//             }, TestRun.empty<I, O, T>()),
//             run => {
//                 run.stats.precision = precision(run.stats);
//                 run.stats.recall = recall(run.stats);
//                 return run;
//             },
//         ),
// );
//

export const diff = ({
    testRun: {stats},
    previousTestRun,
}: {
    testRun: TestRunResults;
    previousTestRun: P.Option.Option<TestRunResults>;
}): Diff =>
    previousTestRun.pipe(
        P.Option.match({
            onNone: () => stats,
            onSome: ({stats: previousStats}) => ({
                TP: stats.TP - previousStats.TP,
                TN: stats.TN - previousStats.TN,
                FP: stats.FP - previousStats.FP,
                FN: stats.FN - previousStats.FN,
                precision: stats.precision - previousStats.precision,
                recall: stats.recall - previousStats.recall,
            }),
        }),
    );
