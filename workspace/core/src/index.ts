import * as Classify from './Classification.js';
import * as Show from './Show.console.js';
import * as Test from './Test.js';
import * as P from './prelude.js';

const testResults$ = Test.testAll({
    testCases: [
        {input: 1, expected: 0.6},
        {input: 2, expected: 2.4},
        {input: 3, expected: 3},
        {input: 4, expected: 4.1},
    ],
    program: input => P.E.succeed(input),
    // classify: Classify.createClassify<number, number>((a, b) => b - a <= 0.2),
});

void P.pipe(
    testResults$,
    // P.Stream.tap(testResult => {
    //     console.log(Show.single({testResult}));
    //     return P.E.unit;
    // }),
    Test.runFoldEffect,
    P.E.tap(testRun =>
        P.Console.log(Show.summary({testRun, previousTestRun: P.O.none()})),
    ),
    // P.E.tap(testRun => P.Console.log(Show.stats({testRun}))),
    // P.E.tap(testRun =>
    //     P.Console.log(Show.diff({testRun, diff: Test.diff({testRun})})),
    // ),
    P.E.runSync,
);
