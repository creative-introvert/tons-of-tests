import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

import * as P from './prelude.js';
import * as Classify from './Classify.js';

export type TestSuite<I = unknown, O = unknown, T = unknown> = {
    testCases: TestCase<I, T>[];
    program: Program<I, O>;
    classify?: Classify.Classify<O, T>;
};

export type TestCase<I, T> = {
    input: I;
    expected: T;
    tags?: string[];
};

export type Program<I, O> = (input: I) => P.E.Effect<O>;

export type ID = string;

export type _TestResult<I = unknown, O = unknown, T = unknown> = {
    id: ID;
    input: I;
    result: O;
    expected: T;
    label: Classify.Label;
    tags: Readonly<string[]>;
};

export class TestResult<
    I = unknown,
    O = unknown,
    T = unknown,
> extends P.Data.TaggedClass('TestResult')<_TestResult<I, O, T>> {
    constructor(args: Omit<_TestResult<I, O, T>, 'id'>) {
        const id = ID.create(args.input);
        super({...args, id});
    }
}

export const TestResultSchema: P.Schema.Schema<_TestResult> = P.Schema.Struct({
    id: P.Schema.String,
    input: P.Schema.Unknown,
    result: P.Schema.Unknown,
    expected: P.Schema.Unknown,
    label: Classify.LabelSchema,
    tags: P.Schema.Array(P.Schema.String),
});

export type _TestRun<I = unknown, O = unknown, T = unknown> = {
    testResultsById: Record<ID, _TestResult<I, O, T>>;
    testResultIds: ID[];
    stats: Classify.Stats;
};

export class TestRun<
    I = unknown,
    O = unknown,
    T = unknown,
> extends P.Data.TaggedClass('TestRun')<_TestRun<I, O, T>> {
    static empty<I, O, T>(): _TestRun<I, O, T> {
        return new TestRun({
            testResultsById: {},
            testResultIds: [],
            stats: Classify.Stats.empty(),
        });
    }
}

export const TestRunSchema: P.Schema.Schema<_TestRun> = P.Schema.Struct({
    testResultsById: P.Schema.Record(P.Schema.String, TestResultSchema),
    testResultIds: P.Schema.mutable(P.Schema.Array(P.Schema.String)),
    stats: Classify.StatsSchema,
});

export type Diff = Record<Classify.Label, number> & {
    precision: number;
    recall: number;
};

export const diff = <I, O, T>({
    testRun: {stats},
    previousTestRun,
}: {
    testRun: _TestRun<I, O, T>;
    previousTestRun: P.O.Option<_TestRun<I, O, T>>;
}): Diff =>
    previousTestRun.pipe(
        P.O.match({
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
}: TestSuite<I, O, T>): P.Stream.Stream<_TestResult<I, O, T>> =>
    P.pipe(
        P.Stream.fromIterable(testCases),
        P.Stream.mapEffect(testCase => test({testCase, program, classify})),
    );

export const runFoldEffect = <I, O, T>(
    testResults$: P.Stream.Stream<_TestResult<I, O, T>>,
): P.E.Effect<_TestRun<I, O, T>> =>
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

/**
 * Convenience function to run all tests and return the results.
 */
export const runAll = <I, O, T>({
    testCases,
    program,
    classify = Classify.make(
        isDeepStrictEqual,
        Classify.defaultIsNil,
        Classify.defaultIsNil,
    ),
}: TestSuite<I, O, T>) =>
    testAll({testCases, program, classify}).pipe(runFoldEffect, P.E.runPromise);

export type TestResultPredicate<I, O, T> = (args: {
    testResult: _TestResult<I, O, T>;
    previousTestResult: P.O.Option<_TestResult<I, O, T>>;
}) => boolean;

/** Filters results. Note, tests still run, but results are filtered out. */
export const filterTestRun: {
    <I, O, T>(
        predicates: TestResultPredicate<I, O, T>[],
    ): (args: {
        testRun: _TestRun<I, O, T>;
        previousTestRun: P.O.Option<_TestRun<I, O, T>>;
    }) => _TestRun<I, O, T>;
    <I, O, T>(
        args: {
            testRun: _TestRun<I, O, T>;
            previousTestRun: P.O.Option<_TestRun<I, O, T>>;
        },
        predicates: TestResultPredicate<I, O, T>[],
    ): _TestRun<I, O, T>;
} = P.dual(
    2,
    <I, O, T>(
        {
            testRun,
            previousTestRun,
        }: {
            testRun: _TestRun<I, O, T>;
            previousTestRun: P.O.Option<_TestRun<I, O, T>>;
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
