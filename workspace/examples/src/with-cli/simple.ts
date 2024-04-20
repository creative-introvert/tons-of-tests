import * as CLI from '@creative-introvert/prediction-testing-cli';
import {Effect} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 1.5);

const testSuite = {
    testCases: [
        {input: 0, expected: 0},
        {input: 1, expected: 2},
        {input: 2, expected: 3},
        {input: 3, expected: 4},
        {input: 4, expected: 5},
    ],
    // Convert myFunction to Effect-returning.
    program: (input: number) => Effect.promise(() => myFunction(input)),
};

void CLI.run({testSuite, dirPath: '.cache', name: 'simple'});
