import * as PT from '@creative-introvert/prediction-testing';
import {Effect} from 'effect';

const testRun = await PT.runAll({
    testCases: [
        {input: 0, expected: 0},
        {input: 1, expected: 2},
        {input: 2, expected: 3},
        {input: 3, expected: 4},
        {input: 4, expected: 5},
    ],
    program: input => Effect.sync(() => input * 2),
});

console.log(PT.Show.summary({testRun}));
