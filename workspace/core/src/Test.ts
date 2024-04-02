import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import * as P from './prelude.js';
import * as Classification from './Classification.js';
import {DuplicateTestCase} from './Error.js';
import {Label} from './Classification.js';
import {showID} from './Show.console.js';

export type Program<I, O> = (input: I) => P.E.Effect<O>;

export type TestCase<I, O> = {
    input: I;
    expected: O;
    tags: string[];
};

export type ID = string;

type _TestResult<I, O> = {
    id: ID;
    input: I;
    expected: O;
    output: O;
    isEqual: boolean;
    label: Classification.Label;
    tags: string[];
};

export class TestResult<I, O> extends P.Data.TaggedClass('TestResult')<
    _TestResult<I, O>
> {
    constructor(args: Omit<_TestResult<I, O>, 'id'>) {
        const id = ID.create(args.input);
        super({...args, id});
    }
}

export class TestRun<I, O> extends P.Data.TaggedClass('TestRun')<{
    testResultsById: Record<ID, TestResult<I, O>>;
    testResultIds: ID[];
    stats: Classification.Stats;
}> {
    static empty<I, O>(): TestRun<I, O> {
        return new TestRun({
            testResultsById: {},
            testResultIds: [],
            stats: Classification.Stats.empty(),
        });
    }
}

export type Diff = Record<Classification.Label, number> & {
    precision: number;
    recall: number;
};

export const diff = <I, O>({
    previousTestRun,
    testRun,
}: {
    previousTestRun?: TestRun<I, O>;
    testRun: TestRun<I, O>;
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

export const test = <I, O>({
    testCase: {input, expected, tags},
    program,
}: {
    testCase: TestCase<I, O>;
    program: Program<I, O>;
}): P.E.Effect<TestResult<I, O>> => {
    return program(input).pipe(
        P.E.map(
            output =>
                new TestResult<I, O>({
                    input,
                    output,
                    expected,
                    isEqual: isDeepStrictEqual(output, expected),
                    tags,
                    label: Classification.classify(output, expected),
                }),
        ),
    );
};

export const testAll = <I, O>({
    testCases,
    program,
}: {
    testCases: TestCase<I, O>[];
    program: Program<I, O>;
}): P.Stream.Stream<TestResult<I, O>> =>
    P.pipe(
        P.Stream.fromIterable(testCases),
        P.Stream.mapEffect(testCase => test({testCase, program})),
    );

export const runFoldEffect = <I, O>(
    testResults$: P.Stream.Stream<TestResult<I, O>>,
): P.E.Effect<TestRun<I, O>> =>
    testResults$.pipe(
        P.Stream.runFoldEffect(TestRun.empty<I, O>(), (run, result) =>
            P.E.gen(function* (_) {
                const {id} = result;

                if (run.testResultsById[id] !== undefined) {
                    yield* _(
                        P.Console.warn(
                            `Skipped duplicate test case. id=${showID(id)}`,
                        ),
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
            run.stats.precision = Classification.precision(run.stats);
            run.stats.recall = Classification.recall(run.stats);
            return run;
        }),
    );

export type TestResultPredicate<I, O> = (args: {
    testResult: TestResult<I, O>;
    previousTestResult: P.O.Option<TestResult<I, O>>;
}) => boolean;

/** Filters results. Note, tests still run, but results are filtered out. */
export const filterTestRun: {
    <I, O>(
        predicates: TestResultPredicate<I, O>[],
    ): (args: {
        testRun: TestRun<I, O>;
        previousTestRun: P.O.Option<TestRun<I, O>>;
    }) => TestRun<I, O>;
    <I, O>(
        args: {
            testRun: TestRun<I, O>;
            previousTestRun: P.O.Option<TestRun<I, O>>;
        },
        predicates: TestResultPredicate<I, O>[],
    ): TestRun<I, O>;
} = P.dual(
    2,
    <I, O>(
        {
            testRun,
            previousTestRun,
        }: {
            testRun: TestRun<I, O>;
            previousTestRun: P.O.Option<TestRun<I, O>>;
        },
        predicates: TestResultPredicate<I, O>[],
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
                        m.testResultsById[id] = {} as TestResult<I, O>;
                    }
                    m.testResultsById[id] = testResult;
                    m.testResultIds.push(id);
                    m.stats[testResult.label]++;
                }

                return m;
            }, TestRun.empty<I, O>()),
            run => {
                run.stats.precision = Classification.precision(run.stats);
                run.stats.recall = Classification.recall(run.stats);
                return run;
            },
        ),
);
