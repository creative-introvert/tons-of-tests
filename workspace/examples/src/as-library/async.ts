import * as PT from '@creative-introvert/prediction-testing';
import {Console, Duration, Effect, Stream} from 'effect';

type Input = number;
type Result = number;

const program = (input: Input) =>
    Effect.promise(() => Promise.resolve(input * 2)).pipe(
        Effect.delay(Duration.millis(500)),
    );

const testCases: PT.Test.TestCase<Input, Result>[] = [
    {input: 0, expected: 0},
    {input: 1, expected: 1},
    {input: 2, expected: 2},
    {input: 3, expected: 3},
    {input: 4, expected: 4},
];

console.time('async');

await PT.Test.all({
    testCases,
    program,
}).pipe(
    Stream.tap(() => {
        console.timeLog('async', 'got a result');
        return Effect.void;
    }),
    PT.Test.runFoldEffect,
    Effect.tap(testRun => Console.log(PT.Show.summarize({testRun}))),
    Effect.runPromise,
);

console.timeEnd('async');
