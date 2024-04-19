import * as PT from '@creative-introvert/prediction-testing';
import {Console, Effect, Option, Stream, pipe} from 'effect';

const testResults$ = PT.testAll({
    testCases: [
        {input: 1, expected: 0.6},
        {input: 2, expected: 2.4},
        {input: 3, expected: 3},
        {input: 4, expected: 4.1},
    ],
    program: input => Effect.succeed(input),
    // Custom classify function.
    classify: PT.Classify.make<number, number>((a, b) => b - a <= 0.2),
});

void pipe(
    testResults$,
    // Track test results as they happen.
    Stream.tap(testResult => {
        console.log(PT.Show.single({testResult}));
        return Effect.void;
    }),
    // Collect test results.
    PT.runFoldEffect,
    // Show summary.
    Effect.tap(testRun =>
        Console.log(PT.Show.summary({testRun, previousTestRun: Option.none()})),
    ),
    // Show stats.
    Effect.tap(testRun => Console.log(PT.Show.stats({testRun}))),
    // Show diff to previous run.
    Effect.tap(testRun =>
        Console.log(PT.Show.diff({testRun, diff: PT.diff({testRun})})),
    ),
    Effect.runSync,
);
