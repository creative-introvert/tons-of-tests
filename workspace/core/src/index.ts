import * as Show from './Show.console.js';
import * as Test from './Test.js';
import * as P from './prelude.js';

const testResults$ = Test.testAll({
    testCases: [
        {input: 'a', expected: {a: 'a'}, tags: []},
        {input: 'b', expected: {b: 'b'}, tags: ['foobar']},
        {input: 'c', expected: {'0': 'c'}, tags: ['foobar']},
        {input: 'b', expected: {'0': 'c'}, tags: ['foobar']},
    ],
    program: input => P.E.succeed({a: input}),
});

void P.pipe(
    testResults$,
    P.Stream.tap(testResult => {
        console.log(Show.single({testResult}));
        return P.E.unit;
    }),
    Test.runFoldEffect,
    // P.E.map(testRun => Show.summary({testRun, previousTestRun: P.O.none()})),
    // P.E.map(testRun => Show.stats({testRun})),
    P.E.map(testRun => Show.diff({testRun, diff: Test.diff({testRun})})),
    P.E.runSync,
    console.log,
);
