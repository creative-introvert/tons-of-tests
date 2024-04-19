import * as PT from '@creative-introvert/prediction-testing';
import {Console, Effect, Option, Stream, pipe} from 'effect';

const testResults$ = PT.testAll({
    testCases: [
        {input: {foo: 1}, expected: {foo: 1}},
        {input: {foo: 2}, expected: {foo: 2}},
        {input: {foo: 3}, expected: {foo: 3}},
        {input: {foo: 4}, expected: {foo: 4}},
    ],
    // Function under test.
    program: ({foo}) => Effect.succeed({foo: foo * 1.05}),
    // Custom classify function.
    classify: PT.Classify.make<{foo: number}, {foo: number}>(
        (output, expected) => Math.abs(expected.foo - output.foo) <= 0.2,
    ),
});

void pipe(
    testResults$,
    // Tests run in a stream, so you can hook into that.
    Stream.tap(testResult => {
        console.log(PT.Show.single({testResult}));
        return Effect.void;
    }),
    // Collect test results.
    PT.runFoldEffect,
    // Show summary.
    Effect.tap(testRun =>
        Console.log(
            PT.Show.summary({
                testRun,
                // With custom renderers. Default = JSON.stringify.
                showInput: ({foo}) => `foo=${foo}`,
                showExpected: ({foo}) => `${foo}`,
                showResult: ({foo}) => `${foo.toFixed(2)}`,
                previousTestRun: Option.none(),
            }),
        ),
    ),
    // Show stats.
    Effect.tap(testRun => Console.log(PT.Show.stats({testRun}))),
    // Show diff to previous run.
    Effect.tap(testRun =>
        Console.log(PT.Show.diff({testRun, diff: PT.diff({testRun})})),
    ),
    Effect.runSync,
);
