import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import * as P from './prelude.js';
import * as Classification from './Classification.js';
import {DuplicateTestCase} from './Error.js';

export type ID = string;

export type TestCase<I, O> = {
    input: I;
    expected: O;
    tags: string[];
};

export type TestResult<I, O> = {
    id: ID;
    input: I;
    output: O;
    expected: O;
    feature: string | undefined;
    tags: string[];
    isEqual: boolean;
    classifiedAs: Classification.Label;
};

export type Program<I, O> = (input: I) => O;

export type TestRun<I, O> = {
    testResultsByFeatureById: Record<ID, Record<string, TestResult<I, O>>>;
    testResultIds: ID[];
    statsByFeature: Record<string, Stats>;
};

export type Stats = Record<Classification.Label, number> & {
    precision: number;
    recall: number;
};

const Stats = {
    empty: (): Stats => ({TP: 0, TN: 0, FP: 0, FN: 0, precision: 0, recall: 0}),
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
        const toHash =
            typeof input === 'string' ? input : JSON.stringify(input);

        return createHash('sha256').update(toHash).digest('hex');
    },
};

export function runRecord<I, O extends Record<string, unknown>>({
    testCase: {input, expected, tags},
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O>;
}): {results: TestResult<I, O[keyof O]>[]; id: string} {
    const id = ID.create(input);
    const results = P.R.toEntries(program(input)).map(([feature, output]) => ({
        id,
        feature,
        input,
        output: output as O[keyof O],
        expected: expected[feature] as O[keyof O],
        isEqual: isDeepStrictEqual(output, expected[feature]),
        tags,
        classifiedAs: Classification.classify(output, expected[feature]),
    }));
    return {results, id};
}

export function runArray<I, O extends P.A.NonEmptyArray<unknown>>({
    testCase: {input, expected, tags},
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O>;
}): {results: TestResult<I, O[keyof O]>[]; id: string} {
    const id = ID.create(input);
    const results = program(input).map((output, i) => ({
        id,
        feature: i.toString(),
        input,
        output: output as O[keyof O],
        expected: expected[i] as O[keyof O],
        isEqual: isDeepStrictEqual(output, expected[i]),
        tags,
        classifiedAs: Classification.classify(output, expected[i]),
    }));
    return {results, id};
}

export function run<I, O>({
    testCase,
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O>;
}): TestResult<I, O> {
    const output = program(testCase.input);
    const id = ID.create(testCase.input);

    const testResult: TestResult<I, O> = {
        id,
        input: testCase.input,
        feature: undefined,
        output,
        expected: testCase.expected,
        isEqual: isDeepStrictEqual(output, testCase.expected),
        tags: testCase.tags,
        classifiedAs: Classification.classify(output, testCase.expected),
    };

    return testResult;
}

export function runAllRecord<I, O extends Record<string, unknown>>({
    testCases,
    program,
}: {
    testCases: TestCase<I, O>[];
    program: Program<I, O>;
}): [TestRun<I, O[keyof O]>, DuplicateTestCase[]] {
    const errors: DuplicateTestCase[] = [];
    const testResultsByFeatureById: Record<
        ID,
        Record<string, TestResult<I, O[keyof O]>>
    > = {};
    const testResultIds: string[] = [];
    const statsByFeature: Record<string, Stats> = {};

    for (const testCase of testCases) {
        const {results, id} = runRecord({testCase, program});
        if (testResultsByFeatureById[id] !== undefined) {
            errors.push(new DuplicateTestCase({id}));
            continue;
        }

        testResultIds.push(id);

        for (const result of results) {
            if (testResultsByFeatureById[result.feature!] === undefined) {
                testResultsByFeatureById[result.feature!] = {};
            }
            testResultsByFeatureById[result.feature!][result.id] = result;

            if (statsByFeature[result.feature!] === undefined) {
                statsByFeature[result.feature!] = Stats.empty();
            }
            statsByFeature[result.feature!][result.classifiedAs]++;
        }
    }

    return [{testResultsByFeatureById, testResultIds, statsByFeature}, errors];
}

export function runAllArray<I, O extends P.A.NonEmptyArray<unknown>>({
    testCases,
    program,
}: {
    testCases: TestCase<I, O>[];
    program: Program<I, O>;
}): [TestRun<I, O[keyof O]>, DuplicateTestCase[]] {
    const errors: DuplicateTestCase[] = [];
    const testResultsByFeatureById: Record<
        ID,
        Record<string, TestResult<I, O[keyof O]>>
    > = {};
    const testResultIds: string[] = [];
    const statsByFeature: Record<string, Stats> = {};

    for (const testCase of testCases) {
        const {results, id} = runArray({testCase, program});
        if (testResultsByFeatureById[id] !== undefined) {
            errors.push(new DuplicateTestCase({id}));
            continue;
        }

        testResultIds.push(id);

        for (const result of results) {
            if (testResultsByFeatureById[result.feature!] === undefined) {
                testResultsByFeatureById[result.feature!] = {};
            }
            testResultsByFeatureById[result.feature!][result.id] = result;

            if (statsByFeature[result.feature!] === undefined) {
                statsByFeature[result.feature!] = Stats.empty();
            }
            statsByFeature[result.feature!][result.classifiedAs]++;
        }
    }

    return [{testResultsByFeatureById, testResultIds, statsByFeature}, errors];
}

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
//     withStats<I, O>({testRun}: {testRun: TestRun<I, O>}): TestRun<I, O> {
//         const stats = {
//             ...testRun.stats,
//             precision: Classification.precision(testRun.stats),
//             recall: Classification.recall(testRun.stats),
//         };
//
//         return {
//             ...testRun,
//             stats,
//         };
//     },
//     empty<I, O>(): TestRun<I, O> {
//         return {
//             testResultsById: {},
//             testResultIds: [],
//             stats: {
//                 TP: 0,
//                 TN: 0,
//                 FP: 0,
//                 FN: 0,
//                 precision: 0,
//                 recall: 0,
//             },
//         };
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
