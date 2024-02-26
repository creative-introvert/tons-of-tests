import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import * as P from './prelude.js';
import * as Classification from './Classification.js';
import {DuplicateTestCase} from './Error.js';

export type Program<I, O, E> = (input: I) => P.λ.Effect<O, E>;

export type TestCase<I, O> = {
    input: I;
    expected: O;
    tags: string[];
};

export type ID = string;

type _TestResultSuccess<I, O, E> = {
    id: ID;
    input: I;
    expected: O;
    output: O;
    tags: string[];
};

type _TestResultError<I, O, E> = {
    id: ID;
    input: I;
    expected: O;
    error: E;
    tags: string[];
};

export class TestResultSuccess<I, O, E> extends P.Data.TaggedClass(
    'TestResultSuccess',
)<_TestResultSuccess<I, O, E>> {
    constructor(args: Omit<_TestResultSuccess<I, O, E>, 'id'>) {
        const id = ID.create(args.input);
        super({...args, id});
    }
}

export class TestResultError<I, O, E> extends P.Data.TaggedClass(
    'TestResultError',
)<_TestResultError<I, O, E>> {
    constructor(args: Omit<_TestResultError<I, O, E>, 'id'>) {
        const id = ID.create(args.input);
        super({...args, id});
    }
}
export type TestResult<I, O, E> =
    | TestResultSuccess<I, O, E>
    | TestResultError<I, O, E>;

export class TestRunSingle<I, O, E> extends P.Data.TaggedClass(
    'TestRunSingle',
)<{
    testResults: Record<ID, TestResult<I, O, E>>;
    testResultIds: ID[];
    stats: Stats;
    features: never[];
}> {}

export class TestRunRecord<I, O, E> extends P.Data.TaggedClass(
    'TestRunRecord',
)<{
    testResults: Record<ID, Record<string, TestResult<I, O, E>>>;
    testResultIds: ID[];
    stats: Record<string, Stats>;
    features: string[];
}> {}

export type TestRun<I, O, E> = TestRunSingle<I, O, E> | TestRunRecord<I, O, E>;

export type Stats = Record<Classification.Label, number> & {
    precision: number;
    recall: number;
};

const Stats = {
    empty: (): Stats => ({
        TP: 0,
        TN: 0,
        FP: 0,
        FN: 0,
        precision: 0,
        recall: 0,
    }),
};

export type Diff = Record<Classification.Label, number> & {
    precision: number;
    recall: number;
};

// =============================================================================
// Impl
// =============================================================================

export const ID = {
    create: <I>(input: I): ID => {
        return createHash('sha256').update(JSON.stringify(input)).digest('hex');
    },
};

export const testRecord = <I, O extends Record<string | number, unknown>, E>({
    testCase: {input, expected, tags},
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O, E>;
}) => {
    return program(input).pipe(
        P.λ.map(P.R.toEntries),
        P.λ.map(
            P.A.map(
                ([feature, output]) =>
                    new TestResult({
                        input,
                        feature: P.O.some(feature),
                        output: output as O[keyof O],
                        expected: expected[feature] as O[keyof O],
                        isEqual: isDeepStrictEqual(output, expected[feature]),
                        tags,
                        classifiedAs: Classification.classify(
                            output,
                            expected[feature],
                        ),
                    }),
            ),
        ),
        P.λ.mapError(
            error =>
                new TestResult<I, O, E>({
                    input,
                    feature: P.O.none(),
                    output: error,
                    expected,
                    isEqual: false,
                    tags,
                    // FIXME: Need enumerate errors in labels.
                    classifiedAs: 'TN',
                }),
        ),
    );
    // .map(
    //     ([feature, output]) =>
    // );
};

export const testSingle = <I, O, E>({
    testCase: {input, expected, tags},
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O, E>;
}): P.λ.Effect<TestResult<I, O, E>> =>
    program(input).pipe(
        P.λ.match({
            onSuccess: output =>
                new TestResult<I, O, E>({
                    input,
                    feature: P.O.none(),
                    output,
                    expected,
                    isEqual: isDeepStrictEqual(output, expected),
                    tags,
                    classifiedAs: Classification.classify(output, expected),
                }),
            onFailure: error =>
                new TestResult<I, O, E>({
                    input,
                    feature: P.O.none(),
                    output: error,
                    expected,
                    isEqual: false,
                    tags,
                    // FIXME: Need enumerate errors in labels.
                    classifiedAs: 'TN',
                }),
        }),
    );

export function runAllRecord<I, O extends Record<string, unknown>>({
    testCases,
    program,
}: {
    testCases: TestCase<I, O>[];
    program: Program<I, O>;
}): [TestRunRecord<I, O[keyof O]>, DuplicateTestCase[]] {
    const errors: DuplicateTestCase[] = [];
    const testResults: TestRunRecord<I, O[keyof O]>['testResults'] = {};
    const testResultIds: string[] = [];
    const stats: Record<string, Stats> = {};

    TESTCASES: for (const testCase of testCases) {
        const {results, id} = testRecord({testCase, program});
        if (testResults[id] !== undefined) {
            errors.push(new DuplicateTestCase({id}));
            continue TESTCASES;
        }

        testResultIds.push(id);

        for (const result of results) {
            if (testResults[id] === undefined) {
                testResults[id] = {};
            }
            testResults[id][result.feature] = result;

            if (stats[result.feature] === undefined) {
                stats[result.feature] = Stats.empty();
            }
            stats[result.feature][result.classifiedAs]++;
        }
    }

    for (const feature of Object.keys(stats)) {
        stats[feature].precision = Classification.precision(stats[feature]);
        stats[feature].recall = Classification.recall(stats[feature]);
    }

    return [new TestRunRecord({testResults, testResultIds, stats}), errors];
}

export function runAllSingle<I, O>({
    testCases,
    program,
}: {
    testCases: TestCase<I, O>[];
    program: Program<I, O>;
}): [TestRunSingle<I, O>, DuplicateTestCase[]] {
    const errors: DuplicateTestCase[] = [];
    const testResults: Record<ID, TestResultSingle<I, O>> = {};
    const testResultIds: string[] = [];
    const stats = Stats.empty();

    for (const testCase of testCases) {
        const result = testSingle({testCase, program});
        const {id} = result;
        if (testResults[id] !== undefined) {
            errors.push(new DuplicateTestCase({id}));
            continue;
        }

        testResultIds.push(id);

        if (testResults[id] === undefined) {
            testResults[id] = result;
        }

        stats[result.classifiedAs]++;
    }

    stats.precision = Classification.precision(stats);
    stats.recall = Classification.recall(stats);

    return [new TestRunSingle({testResults, testResultIds, stats}), errors];
}

type Predicate<I, O> = (input: {
    result: TestResult<I, O>;
    previousResult: P.O.Option<TestResult<I, O>>;
}) => boolean;

export const filter: {
    <I, O>(
        predicate: Predicate<I, O>,
    ): (data: {
        result: TestRun<I, O>;
        previousRun: P.O.Option<TestRun<I, O>>;
    }) => TestRun<I, O>;
    <I, O>(
        data: {
            result: TestRun<I, O>;
            previousRun: P.O.Option<TestRun<I, O>>;
        },
        predicate: Predicate<I, O>,
    ): TestRun<I, O>;
} = P.dual(
    2,
    <I, O>(
        data: {
            result: TestRun<I, O>;
            previousRun: P.O.Option<TestRun<I, O>>;
        },
        predicate: Predicate<I, O>,
    ) => P.hole(),
);

// export const Run = {
//     filter: <I, O>({
//         predicate,
//         testRun,
//         previousTestRun,
//     }: {
//         predicate: (
//             result: TestResult<I, O>,
//             previousResult: P.O.Option<TestResult<I, O>>,
//         ) => boolean;
//         testRun: TestRun<I, O>;
//         previousTestRun: P.O.Option<TestRun<I, O>>;
//     }) => {
//         return testRun.testResultIds.reduce<TestRun<I, O>>(
//             (m, id) => {
//                 const result = testRun.testResultsById[id];
//                 const previousResult = previousTestRun.pipe(
//                     P.O.map(a => a.testResultsById[id]),
//                 );
//                 const isMatch = predicate(result, previousResult);
//
//                 if (isMatch) {
//                     if (m.testResultsById[id] === undefined) {
//                         m.testResultsById[id] = {} as TestResult<I, O>;
//                     }
//                     m.testResultsById[id] = result;
//                     m.testResultIds.push(id);
//                 }
//
//                 return m;
//             },
//             {
//                 testResultsById: {},
//                 testResultIds: [],
//                 // TODO: re-calculate
//                 stats: testRun.stats,
//             },
//         );
//     },
// };
//
// export const diff = <I, O>({
//     previousTestRun,
//     testRun,
// }: {
//     previousTestRun?: TestRun<I, O>;
//     testRun: TestRun<I, O>;
// }): Diff => {
//     const stats = testRun.stats;
//     const previousStats = previousTestRun && previousTestRun.stats;
//
//     const TP = stats.TP;
//     const previousTP = previousStats?.TP ?? 0;
//
//     const TN = stats.TN;
//     const previousTN = previousStats?.TN ?? 0;
//
//     const FP = stats.FP;
//     const previousFP = previousStats?.FP ?? 0;
//
//     const FN = stats.FN;
//     const previousFN = previousStats?.FN ?? 0;
//
//     const precision = stats.precision;
//     const previousPrecision = previousStats?.precision ?? 0;
//
//     const previousRecall = previousStats?.recall ?? 0;
//     const recall = stats.recall;
//
//     return {
//         TP: TP - previousTP,
//         TN: TN - previousTN,
//         FP: FP - previousFP,
//         FN: FN - previousFN,
//         precision: precision - previousPrecision,
//         recall: recall - previousRecall,
//     };
// };
