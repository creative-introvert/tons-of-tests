import {createHash} from 'node:crypto';

import * as Classification from './Classification.js';
import {DuplicateTestCase} from './Error.js';

export type Literal = string | number | boolean | null;
export type Json = Literal | {[key: string]: Json} | Json[];

export type ID = string;
export type Feature = string;
// TODO: Option
export type Value = Json | undefined;

export type Case<K extends Feature, T extends Json> = Record<K, Json> & {
    input: T;
};

export type Result<K extends Feature, T extends Json> = {
    id: ID;
    feature: K;
    input: T;
    output?: Value;
    expected?: Value;
    equals: boolean;
    classificationLabel: Classification.Label;
};

export type FunctionUnderTest<K extends Feature, T extends Json> = (
    input: T,
) => Record<K, Value>;

export type Run<K extends Feature, T extends Json> = {
    features: readonly K[];
    testResultsById: Record<ID, Record<K, Result<K, T>>>;
    testResultIds: ID[];
    statsByFeature: Record<
        K,
        {
            [Classification.Label.TP]: number;
            [Classification.Label.TN]: number;
            [Classification.Label.FP]: number;
            [Classification.Label.FN]: number;
            precision: number;
            recall: number;
        }
    >;
};

export type Diff<K extends Feature> = {
    feature: K;
    TP: number;
    TN: number;
    FP: number;
    FN: number;
    precision: number;
    recall: number;
};

// =============================================================================
// Impl
// =============================================================================

// TODO: I think I get this for free from
// https://effect-ts.github.io/effect/effect/Data.ts.html
export const ID = {
    fromInput: <T extends Json>(input: T): ID => {
        const toHash =
            input === undefined
                ? 'undefined'
                : typeof input === 'string'
                  ? input
                  : JSON.stringify(input);

        return createHash('sha256').update(toHash).digest('hex');
    },
};

// TODO: https://effect-ts.github.io/effect/effect/Equal.ts.html
export const equals = <T extends Json>(a?: T, b?: T): boolean => {
    return a === b;
};

/*
 * Runs a single test and returns one result per feature.
 * We differentiate between features to be able to measure precision/recall per feature.
 * `input` is redundantly stored for convenience.
 */
export function runSingle<K extends Feature, T extends Json>({
    features,
    testCase,
    f,
    createId = ID.fromInput,
}: {
    features: readonly K[];
    testCase: Case<K, T>;
    f: FunctionUnderTest<K, T>;
    createId: (input: T) => ID;
}): {resultByFeature: Record<K, Result<K, T>>; id: ID} {
    const output = f(testCase.input);
    const id = createId(testCase.input);

    return features.reduce<{
        resultByFeature: Record<K, Result<K, T>>;
        id: ID;
    }>(
        (m, feature) => {
            const testResult: Result<K, T> = {
                id,
                input: testCase.input,
                feature,
                output: output[feature],
                expected: testCase[feature],
                equals: equals(output[feature], testCase[feature]),
                classificationLabel: Classification.classify(
                    output[feature],
                    testCase[feature],
                ),
            };
            m.resultByFeature[feature] = testResult;
            return m;
        },
        {resultByFeature: {} as Record<K, Result<K, T>>, id},
    );
}

export const Run = {
    filter: <K extends Feature, T extends Json>({
        predicate,
        testRun,
        previousTestRun,
    }: {
        predicate: (
            result: Result<K, T>,
            previousResult?: Result<K, T>,
        ) => boolean;
        testRun: Run<K, T>;
        previousTestRun?: Run<K, T>;
    }) => {
        return testRun.testResultIds.reduce<Run<K, T>>(
            (m, id) => {
                const byFeature = testRun.testResultsById[id];
                const previousByFeature = previousTestRun?.testResultsById[id];

                for (const feature of testRun.features) {
                    const result = byFeature[feature];
                    const previousResult =
                        previousByFeature && previousByFeature[feature];

                    if (
                        result !== undefined &&
                        predicate(result, previousResult)
                    ) {
                        if (m.testResultsById[id] === undefined) {
                            m.testResultsById[id] = {} as Record<
                                K,
                                Result<K, T>
                            >;
                        }
                        m.testResultsById[id][feature] = result;
                    }
                }

                if (m.testResultsById[id]) {
                    m.testResultIds.push(id);
                }

                return m;
            },
            {
                testResultsById: {},
                testResultIds: [],
                features: testRun.features,
                // These aren't filtered, but it makes no sense to filter them anyways.
                statsByFeature: testRun.statsByFeature,
            },
        );
    },
    withStats<K extends Feature, T extends Json>({
        testRun,
        features,
    }: {
        testRun: Run<K, T>;
        features: readonly K[];
    }): Run<K, T> {
        const statsByFeature = features.reduce(
            (m, feature) => {
                const stats = testRun.statsByFeature[feature];
                m[feature] = {
                    ...stats,
                    precision: Classification.precision(stats),
                    recall: Classification.recall(stats),
                };
                return m;
            },
            {} as Run<K, T>['statsByFeature'],
        );

        return {
            ...testRun,
            statsByFeature,
        };
    },
    empty<K extends Feature, T extends Json>(
        features: readonly K[],
    ): Run<K, T> {
        return {
            testResultsById: {},
            testResultIds: [],
            features,
            statsByFeature: features.reduce(
                (m, feature) => {
                    m[feature] = {
                        [Classification.Label.TP]: 0,
                        [Classification.Label.TN]: 0,
                        [Classification.Label.FP]: 0,
                        [Classification.Label.FN]: 0,
                        precision: 0,
                        recall: 0,
                    };
                    return m;
                },
                {} as Run<K, T>['statsByFeature'],
            ),
        };
    },
};

export type RunCasesArgs<K extends Feature, T extends Json> = {
    features: readonly K[];
    testCases: Case<K, T>[];
    f: FunctionUnderTest<K, T>;
    createId: (input: T) => ID;
};

export function runAll<K extends Feature, T extends Json>({
    features,
    testCases,
    f,
    createId,
}: RunCasesArgs<K, T>): Run<K, T> & {errors: DuplicateTestCase[]} {
    const withoutStats = testCases.reduce<
        Run<K, T> & {errors: DuplicateTestCase[]}
    >(
        (m, testCase) => {
            const {resultByFeature: testResultByFeature, id} = runSingle({
                features,
                testCase,
                f,
                createId,
            });

            if (m.testResultsById[id] !== undefined) {
                const e = new DuplicateTestCase({id, input: testCase.input});
                m.errors.push(e);
                return m;
            }

            m.testResultIds.push(id);
            m.testResultsById[id] = testResultByFeature;
            for (const feature of features) {
                m.statsByFeature[feature][
                    testResultByFeature[feature].classificationLabel
                ]++;
            }
            return m;
        },
        {...Run.empty(features), errors: []},
    );

    const errors = withoutStats.errors;
    const withStats = Run.withStats({testRun: withoutStats, features});
    return {...withStats, errors};
}

export const diff = <K extends Feature, T extends Json>({
    previousTestRun,
    testRun,
}: {
    previousTestRun?: Run<K, T>;
    testRun: Run<K, T>;
}): Diff<K>[] => {
    const features = testRun.features;
    return features.map(feature => {
        const stats = testRun.statsByFeature[feature];
        const previousStats =
            previousTestRun && previousTestRun.statsByFeature[feature];

        const TP = stats.TP;
        const previousTP = previousStats?.TP ?? 0;

        const TN = stats.TN;
        const previousTN = previousStats?.TN ?? 0;

        const FP = stats.FP;
        const previousFP = previousStats?.FP ?? 0;

        const FN = stats.FN;
        const previousFN = previousStats?.FN ?? 0;

        const precision = stats.precision;
        const previousPrecision = previousStats?.precision ?? 0;

        const previousRecall = previousStats?.recall ?? 0;
        const recall = stats.recall;

        return {
            feature,
            TP: TP - previousTP,
            TN: TN - previousTN,
            FP: FP - previousFP,
            FN: FN - previousFN,
            precision: precision - previousPrecision,
            recall: recall - previousRecall,
        };
    });
};
