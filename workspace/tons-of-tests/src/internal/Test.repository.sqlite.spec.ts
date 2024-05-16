import * as t from '@effect/vitest';
import * as Sql from '@effect/sql';

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

    t.effect.only('clearStale', () =>
        P.Effect.gen(function* () {
            const repository = yield* TR.TestRepository;

            const nameA = 'to-be-cleared';
            const nameB = 'dont-clear-me';

            // Set up some alternative test runs,
            // which are not supposed to be cleared.
            yield* T.all({
                testCases: [{input: 'a', expected: 'A!'}],
                program: s => P.Effect.succeed(s.toUpperCase()),
                name: nameB,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            yield* repository.commitCurrentTestRun({
                name: nameB,
                hash: `${nameB}-1`,
            });

            yield* T.all({
                testCases: [{input: 'a', expected: 'A!'}],
                program: s => P.Effect.succeed(s.toUpperCase() + '!'),
                name: nameB,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            yield* repository.commitCurrentTestRun({
                name: nameB,
                hash: `${nameB}-2`,
            });

            yield* T.all({
                testCases: [{input: 'a', expected: 'A!'}],
                program: s => P.Effect.succeed(s.toUpperCase() + '!!'),
                name: nameB,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            // Set up the main test runs to be cleared.
            yield* T.all({
                testCases: [{input: 1, expected: 10}],
                program: n => P.Effect.succeed(n + 1),
                name: nameA,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            yield* repository.commitCurrentTestRun({
                name: nameA,
                hash: `${nameA}-1`,
            });

            yield* T.all({
                testCases: [{input: 1, expected: 10}],
                program: n => P.Effect.succeed(n + 2),
                name: nameA,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            yield* repository.commitCurrentTestRun({
                name: nameA,
                hash: `${nameA}-2`,
            });

            yield* T.all({
                testCases: [{input: 1, expected: 10}],
                program: n => P.Effect.succeed(n * 10),
                name: nameA,
            }).pipe(P.Effect.flatMap(P.Stream.runDrain));

            yield* repository.clearStale({name: nameA});

            const sql = yield* Sql.client.Client;

            const all = yield* sql`
                SELECT
                    res.result,
                    runs.*
                FROM ${sql(TR.tables.testResults)} res
                JOIN ${sql(TR.tables.testRunResults)} runres ON res.id = runres.testResult
                JOIN ${sql(TR.tables.testRuns)} runs ON runs.id = runres.testRun
                ORDER BY ordering ASC;
            `;

            t.assert.deepStrictEqual(all, [
                {result: '"A"', id: 1, name: nameB, hash: `${nameB}-1`},
                {result: '"A!"', id: 2, name: nameB, hash: `${nameB}-2`},
                {result: '"A!!"', id: 3, name: nameB, hash: null},
                {result: '3', id: 5, name: nameA, hash: `${nameA}-2`},
                {result: '10', id: 6, name: nameA, hash: null},
            ]);
        }).pipe(
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
