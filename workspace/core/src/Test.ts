import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import * as P from './prelude.js';
import * as Classify from './Classify.js';

export type Program<I, O> = (input: I) => P.E.Effect<O>;

export type TestCase<I, T> = {
    input: I;
    expected: T;
    tags?: string[];
};

export type ID = string;

type _TestResult<I, O, T> = {
    id: ID;
    input: I;
    result: O;
    expected: T;
    label: Classify.Label;
    tags: string[];
};

export class TestResult<I, O, T> extends P.Data.TaggedClass('TestResult')<
    _TestResult<I, O, T>
> {
    constructor(args: Omit<_TestResult<I, O, T>, 'id'>) {
        const id = ID.create(args.input);
        super({...args, id});
    }
}

export class TestRun<I, O, T> extends P.Data.TaggedClass('TestRun')<{
    testResultsById: Record<ID, TestResult<I, O, T>>;
    testResultIds: ID[];
    stats: Classify.Stats;
}> {
    static empty<I, O, T>(): TestRun<I, O, T> {
        return new TestRun({
            testResultsById: {},
            testResultIds: [],
            stats: Classify.Stats.empty(),
        });
    }
}

export type Diff = Record<Classify.Label, number> & {
    precision: number;
    recall: number;
};

export const diff = <I, O, T>({
    previousTestRun,
    testRun,
}: {
    previousTestRun?: TestRun<I, O, T>;
    testRun: TestRun<I, O, T>;
}): Diff => {
    const stats = testRun.stats;
    const previousStats = previousTestRun && previousTestRun.stats;

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
        TP: TP - previousTP,
        TN: TN - previousTN,
        FP: FP - previousFP,
        FN: FN - previousFN,
        precision: precision - previousPrecision,
        recall: recall - previousRecall,
    };
};

export const ID = {
    create: <I>(input: I): ID => {
        return createHash('sha256').update(JSON.stringify(input)).digest('hex');
    },
};

export const test = <I, O, T>({
    testCase: {input, expected, tags},
    program,
    classify,
}: {
    testCase: TestCase<I, T>;
    program: Program<I, O>;
    classify: Classify.Classify<O, T>;
}): P.E.Effect<TestResult<I, O, T>> => {
    return program(input).pipe(
        P.E.map(
            result =>
                new TestResult<I, O, T>({
                    input,
                    result,
                    expected,
                    tags: tags ?? [],
                    label: classify(result, expected),
                }),
        ),
    );
};

export const testAll = <I, O, T>({
    testCases,
    program,
    classify = Classify.make(
        isDeepStrictEqual,
        Classify.defaultIsNil,
        Classify.defaultIsNil,
    ),
}: {
    testCases: TestCase<I, T>[];
    program: Program<I, O>;
    classify?: Classify.Classify<O, T>;
}): P.Stream.Stream<TestResult<I, O, T>> =>
    P.pipe(
        P.Stream.fromIterable(testCases),
        P.Stream.mapEffect(testCase => test({testCase, program, classify})),
    );

export const runFoldEffect = <I, O, T>(
    testResults$: P.Stream.Stream<TestResult<I, O, T>>,
): P.E.Effect<TestRun<I, O, T>> =>
    testResults$.pipe(
        P.Stream.runFoldEffect(TestRun.empty<I, O, T>(), (run, result) =>
            P.E.gen(function* (_) {
                const {id} = result;

                if (run.testResultsById[id] !== undefined) {
                    yield* _(
                        P.Console.warn(`Skipped duplicate test case. id=${id}`),
                    );
                    return run;
                } else {
                    run.testResultsById[id] = result;
                    run.testResultIds.push(id);
                    run.stats[result.label]++;
                }

                return run;
            }),
        ),
        P.E.map(run => {
            run.stats.precision = Classify.precision(run.stats);
            run.stats.recall = Classify.recall(run.stats);
            return run;
        }),
    );

export type TestResultPredicate<I, O, T> = (args: {
    testResult: TestResult<I, O, T>;
    previousTestResult: P.O.Option<TestResult<I, O, T>>;
}) => boolean;

/** Filters results. Note, tests still run, but results are filtered out. */
export const filterTestRun: {
    <I, O, T>(
        predicates: TestResultPredicate<I, O, T>[],
    ): (args: {
        testRun: TestRun<I, O, T>;
        previousTestRun: P.O.Option<TestRun<I, O, T>>;
    }) => TestRun<I, O, T>;
    <I, O, T>(
        args: {
            testRun: TestRun<I, O, T>;
            previousTestRun: P.O.Option<TestRun<I, O, T>>;
        },
        predicates: TestResultPredicate<I, O, T>[],
    ): TestRun<I, O, T>;
} = P.dual(
    2,
    <I, O, T>(
        {
            testRun,
            previousTestRun,
        }: {
            testRun: TestRun<I, O, T>;
            previousTestRun: P.O.Option<TestRun<I, O, T>>;
        },
        predicates: TestResultPredicate<I, O, T>[],
    ) =>
        P.pipe(
            testRun.testResultIds.reduce((m, id) => {
                const testResult = testRun.testResultsById[id];
                const previousTestResult = previousTestRun.pipe(
                    P.O.map(a => a.testResultsById[id]),
                );
                const isMatch = predicates.every(p =>
                    p({testResult, previousTestResult}),
                );

                if (isMatch) {
                    if (m.testResultsById[id] === undefined) {
                        m.testResultsById[id] = {} as TestResult<I, O, T>;
                    }
                    m.testResultsById[id] = testResult;
                    m.testResultIds.push(id);
                    m.stats[testResult.label]++;
                }

                return m;
            }, TestRun.empty<I, O, T>()),
            run => {
                run.stats.precision = Classify.precision(run.stats);
                run.stats.recall = Classify.recall(run.stats);
                return run;
            },
        ),
);
