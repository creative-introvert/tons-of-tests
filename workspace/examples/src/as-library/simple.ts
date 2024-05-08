import {randomUUID} from 'node:crypto';

import * as PT from '@creative-introvert/prediction-testing';
import {Console, Effect, Layer, Option, Stream} from 'effect';

type TestCase = PT.Test.TestCase<unknown, {BRAND: string; MODEL?: number}>;

const testCases: TestCase[] = [
    {input: null, expected: {BRAND: 'Claas'}},
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
        tags: ['tractor', 'asdf'],
    },
];

const main = Effect.gen(function* () {
    const testRespository = yield* PT.TestRepository.TestRepository;
    const name = 'cli-simple';

    // yield* testRespository.commitCurrentTestRun({
    //     name,
    //     hash: randomUUID(),
    // });

    // yield* testRespository.clearCurrentTestRun(name);
    const currentTestRun =
        yield* testRespository.getOrCreateCurrentTestRun(name);
    // yield* testRespository.purgeStaleTestRuns(name);

    // const trs = yield* PT.Test.all({
    //     testCases,
    //     program: input => Effect.sync(() => input),
    //     name,
    // }).pipe(Stream.runCollect);

    yield* Console.log(yield* testRespository.getAllTestRuns);
    // yield* Console.log(
    //     yield* testRespository
    //         .getTestResultsStream(currentTestRun)
    //         .pipe(Stream.runCollect),
    // );
    yield* Console.log(yield* testRespository.getAllTestResults);

    // const testRun2 = await PT.Test.runAll({
    //     testCases,
    //     program: input =>
    //         Effect.sync(() => ({...input, MODEL: input?.MODEL ?? 0 + 100})),
    // });
    // console.log(
    //     PT.Show.summarize({
    //         testRun: testRun1,
    //         previousTestRun: Option.some(testRun2),
    //     }),
    // );
    //
    // console.log(PT.Show.stats({testRun: testRun1}));
    //
    // const diff = PT.Test.diff({
    //     testRun: testRun1,
    //     previousTestRun: Option.some(testRun2),
    // });
    //
    // console.log(PT.Show.diff({diff}));
});

const LiveLayer = Layer.provideMerge(
    PT.TestRepository.LiveLayer,
    PT.TestRepository.makeSqliteLiveLayer('as-library-simple.db'),
);

void main.pipe(Effect.provide(LiveLayer), Effect.runPromise);
