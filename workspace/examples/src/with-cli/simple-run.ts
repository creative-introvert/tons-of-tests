import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 1.7);
const classify = Classify.makeClassify<number, number>({
    isEqual: (a, b) => Math.abs(b - a) <= 0.4,
});

CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: [
            {input: 0, expected: 0},
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
            {input: 4, expected: 5},
        ],
        evaluate: (result, expected) => [
            {
                key: 'result',
                result,
                expected,
                label: classify(result, expected),
            },
        ],
        program: (input: number) => Effect.promise(() => myFunction(input)),
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 1,
});
