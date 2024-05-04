import * as PT from '@creative-introvert/prediction-testing';
import {Effect, Option} from 'effect';

type TestCase = PT.Test.TestCase<
    {BRAND: string; MODEL?: number; MACHINE_TYPE?: string},
    {BRAND: string; MODEL?: number}
>;

const testCases: TestCase[] = [
    {input: {BRAND: 'Claas'}, expected: {BRAND: 'Claas'}},
    {input: {BRAND: 'John Deere'}, expected: {BRAND: 'John Deere'}},
    {
        input: {BRAND: 'John Deere', MODEL: 8100},
        expected: {BRAND: 'John Deere', MODEL: 8300},
    },
    {
        input: {
            BRAND: 'John Deere',
            MODEL: 8400,
            MACHINE_TYPE: 'tractor',
        },
        expected: {
            BRAND: 'John Deere',
            MODEL: 8400,
        },
    },
];

const testRun1 = await PT.Test.runAll({
    testCases,
    program: input => Effect.sync(() => input),
});

const testRun2 = await PT.Test.runAll({
    testCases,
    program: input =>
        Effect.sync(() => ({...input, MODEL: input?.MODEL ?? 0 + 100})),
});

console.log(
    PT.Show.summarize({
        testRun: testRun1,
        previousTestRun: Option.some(testRun2),
    }),
);

console.log(PT.Show.stats({testRun: testRun1}));

const diff = PT.Test.diff({
    testRun: testRun1,
    previousTestRun: Option.some(testRun2),
});

console.log(PT.Show.diff({diff}));
