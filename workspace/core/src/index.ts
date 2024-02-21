import {runAllRecord, type TestCase} from './Test.js';

const test: TestCase<string, Record<string, unknown>> = {
    input: 'foo',
    expected: {feature: 'foo'},
    tags: [],
};

const run = runAllRecord({
    testCases: [test],
    program: feature => ({feature}),
});

console.log(JSON.stringify(run, null, 2));
