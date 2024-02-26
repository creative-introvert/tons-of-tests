import {runAllRecord, type TestCase} from './Test.js';

const run = runAllRecord({
    testCases: [
        {input: 'a', expected: {a: 'a'}, tags: []},
        {input: 'b', expected: {b: 'b'}, tags: ['foobar']},
        {input: 'c', expected: {'0': 'c'}, tags: ['foobar']},
    ],
    program: input => ({a: input}),
});

console.log(JSON.stringify(run, null, 2));
