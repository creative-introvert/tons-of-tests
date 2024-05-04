import * as CLI from '@creative-introvert/prediction-testing-cli';
import {Effect} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 2);

void CLI.run({
    testSuite: {
        // Convert myFunction to Effect-returning.
        program: (n: number) => Effect.promise(() => myFunction(n)),
        testCases: [
            {input: 0, expected: 0},
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
            {input: 4, expected: 5},
        ],
    },
    testSuiteName: 'simple',
    // Currently, test results are written to the file-system.
    // This will be replaced by an SQLite backend soon™.
    dirPath: '.metrics',
    filePostfix: 'ptest',
});
