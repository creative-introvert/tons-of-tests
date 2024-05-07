import * as t from '@effect/vitest';

import * as P from '../prelude.js';
import type * as Test from '../Test.js';
import * as T from './Test.js';
import * as TR from './Test.repository.sqlite.js';

type TestCase = Test.TestCase<number, number>;
const add = (input: number) => P.Effect.succeed(input + 1);
const subtract = (input: number) => P.Effect.succeed(input - 1);

const testCases: TestCase[] = [
    {input: 1, expected: 2},
    {input: 2, expected: 3},
    {input: 3, expected: 4},
];

t.describe('Test.repository.sqlite', () => {
    t.effect('getOrCreateCurrentTestRun', () =>
        P.Effect.gen(function* () {
            const name = 'getOrCreateCurrentTestRun';
            const repository = yield* TR.TestRepository;
            const a = yield* repository.getOrCreateCurrentTestRun(name);
            yield* repository.commitCurrentTestRun({
                name,
                hash: `${name}-1`,
            });
            const b = yield* repository.getOrCreateCurrentTestRun(name);

            t.assert.notStrictEqual(a, b);
        }).pipe(
            P.Effect.tapError(e => P.Console.error(e)),
            P.Effect.provide(TR.LiveLayer),
            P.Effect.provide(TR.SqliteTestLayer),
        ),
    );

    t.effect('clearTestRun', () =>
        P.Effect.gen(function* () {
            const name = 'clearTestRun';
            const repository = yield* TR.TestRepository;
            const currentTestRun =
                yield* repository.getOrCreateCurrentTestRun(name);

            const results = yield* T.all({testCases, program: add, name}).pipe(
                P.Effect.flatMap(P.Stream.runCollect),
            );

            t.assert.strictEqual(results.length, 3);

            yield* repository.clearTestRun(currentTestRun);

            const postClear = yield* repository
                .getTestResultsStream(currentTestRun)
                .pipe(P.Stream.runCollect);

            t.assert.strictEqual(postClear.length, 0);
        }).pipe(
            P.Effect.tapError(e => P.Console.error(e)),
            P.Effect.provide(TR.LiveLayer),
            P.Effect.provide(TR.SqliteTestLayer),
        ),
    );

    t.effect('insertTestResult', () =>
        P.Effect.gen(function* () {
            const name = 'insertTestResult';
            const repository = yield* TR.TestRepository;
            yield* repository.getOrCreateCurrentTestRun(name);
            const r1 = yield* T.all({testCases, program: add, name}).pipe(
                P.Stream.runCollect,
            );
            // yield* repository.commitCurrentTestRun({
            //     name,
            //     hash: `${name}-1`,
            // });
            // const r2 = yield* T.all({
            //     testCases: [
            //         {input: 4, expected: 2},
            //         {input: 5, expected: 3},
            //         {input: 6, expected: 4},
            //     ],
            //     program: add,
            //     name,
            // }).pipe(P.Stream.runCollect);
            //
            // t.assert.equal(r1.length, r2.length);
        }).pipe(
            P.Effect.tapError(e => P.Console.error(e)),
            P.Effect.provide(TR.LiveLayer),
            P.Effect.provide(TR.SqliteTestLayer),
        ),
    );
});
