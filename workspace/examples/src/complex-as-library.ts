import {isDeepStrictEqual} from 'node:util';

import * as PT from '@creative-introvert/prediction-testing';
import {Console, Effect, Option, Stream, pipe} from 'effect';
import * as diff from 'deep-object-diff';

type Input = number;
type Result = {foo: number};

// Function under test.
const program = (foo: Input) => Effect.succeed({foo: foo * 1.1});

const testCases: PT.TestCase<Input, Result>[] = [
    {input: 0, expected: {foo: 0}},
    {input: 1, expected: {foo: 1}},
    {input: 2, expected: {foo: 2}},
    {input: 3, expected: {foo: 3}},
    {input: 4, expected: {foo: 4}},
];

// An (optional) custom classifier. By default, it uses deep equality.
const classify = PT.Classify.make<Result, Result>(
    (output, expected) => Math.abs(expected.foo - output.foo) <= 0.2,
);

// Simulate a previous run with different results.
const previousTestRun = PT.testAll({
    testCases,
    program: (foo: Input) => Effect.succeed({foo}),
    classify,
}).pipe(PT.runFoldEffect, Effect.runSync);

void pipe(
    PT.testAll({testCases, program, classify}),
    // Tests are a stream, so you can hook into that.
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
                showInput: input => `input=${input}`,
                showExpected: expected => `${expected.foo.toFixed(2)} +/- 0.2`,
                // showResult gets the result and the expected value.
                showResult: (result, expected) => {
                    if (isDeepStrictEqual(result, expected)) {
                        return JSON.stringify(result);
                    }
                    return JSON.stringify(
                        Object.entries(
                            diff.detailedDiff(expected, result),
                        ).reduce((m, [k, v]) => {
                            if (Object.keys(v).length !== 0) {
                                m[k] = v;
                            }
                            return m;
                        }, {} as any),
                    );
                },
                previousTestRun: Option.some(previousTestRun),
            }),
        ),
    ),
    // Show stats.
    Effect.tap(testRun => Console.log(PT.Show.stats({testRun}))),
    // Show diff to previous run.
    Effect.tap(testRun =>
        Console.log(
            PT.Show.diff({testRun, diff: PT.diff({testRun, previousTestRun})}),
        ),
    ),
    Effect.runSync,
);
