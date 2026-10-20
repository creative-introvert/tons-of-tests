import * as SqlClient from 'effect/sql/SqlClient';
import * as Sqlite from '@effect/sql-sqlite-node';
import * as t from '@effect/vitest';
import {Cause, Effect, Exit, Option, Schema, Stream} from 'effect';

import {SqlError} from 'effect/sql/SqlError';
import type * as Test from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {TestRun} from '../TestRun.js';
import * as T from './Test.js';
import * as TR from './Test.repository.sqlite.js';
import {
    getAllTestRuns,
    getAllTestResults,
    getAllTestRunResults,
} from './test-repository-fixtures.js';

type TestCase = Test.TestCase<number, number>;
const add = (input: number) => Effect.succeed(input + 1);

// Each test uses a unique suite name and scopes queries to its own run via
// getTestResultsStream, so tests are robust to vitest reordering and the
// shared in-memory db contents from other tests in the same describe block.

t.describe('Test.repository.sqlite', () => {
    t.layer(TestRepository.TestLayer, {excludeTestServices: true})(
        'with shared in-memory db',
        it => {
            it.effect(
                'getOrCreateCurrentTestRun creates, then re-creates after commit',
                () =>
                    Effect.gen(function* () {
                        const name = 'suite-get-or-create';
                        const repository = yield* TestRepository;
                        const missing = yield* repository.commitCurrentTestRun({
                            name,
                            hash: 'missing',
                        });

                        const a =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        t.expect(a.name).toBe(name);
                        t.expect(a.hash).toBeNull();
                        const empty = yield* repository.commitCurrentTestRun({
                            name,
                            hash: 'empty',
                        });

                        // commitCurrentTestRun bails early if the current run has no
                        // results, so insert one first.
                        yield* T.all({
                            testCases: [{input: 0, expected: 1}],
                            program: add,
                            name,
                        }).pipe(
                            Stream.tap(_ => repository.insertTestResult(_, a)),
                            Stream.runDrain,
                        );
                        const saved = yield* repository.commitCurrentTestRun({
                            name,
                            hash: `${name}-1`,
                        });

                        const b =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        t.expect(b.name).toBe(name);
                        t.expect(b.hash).toBeNull();
                        // A fresh current-run row was created; the original was committed.
                        t.expect(b.id).not.toBe(a.id);

                        const runs = (yield* getAllTestRuns).filter(
                            r => r.name === name,
                        );
                        const committed = runs.find(r => r.id === a.id);
                        t.expect(committed?.hash).toBe(`${name}-1`);
                        t.expect([missing, empty, saved]).toEqual([
                            'NothingToCommit',
                            'NothingToCommit',
                            'Committed',
                        ]);
                    }),
            );

            it.effect(
                'insertTestResult: round-trip + idempotent on re-insert',
                () =>
                    Effect.gen(function* () {
                        const name = 'suite-insert';
                        const testCases: TestCase[] = [
                            {input: 111, expected: 112, tags: ['a', 'b']},
                            {input: 112, expected: 113, tags: []},
                            {input: 113, expected: 114},
                        ];
                        const repository = yield* TestRepository;
                        const testRun =
                            yield* repository.getOrCreateCurrentTestRun(name);

                        yield* T.all({testCases, program: add, name}).pipe(
                            Stream.tap(_ =>
                                repository.insertTestResult(_, testRun),
                            ),
                            Stream.runDrain,
                        );

                        const scopeToRun = Effect.gen(function* () {
                            const junction = yield* getAllTestRunResults;
                            const all = yield* getAllTestResults;
                            const idsForRun = new Set(
                                junction
                                    .filter(j => j.testRun === testRun.id)
                                    .map(j => j.testResult),
                            );
                            return all.filter(r => idsForRun.has(r.id));
                        });

                        const scoped = yield* scopeToRun;
                        t.expect(scoped).toHaveLength(testCases.length);
                        const first = scoped.find(r => r.ordering === 0);
                        t.expect(first?.tags).toEqual(['a', 'b']);
                        const second = scoped.find(r => r.ordering === 1);
                        t.expect(second?.tags).toEqual([]);

                        const junctionBefore =
                            (yield* getAllTestRunResults).filter(
                                j => j.testRun === testRun.id,
                            );

                        // Re-inserting results keeps one row per result and run.
                        yield* T.all({testCases, program: add, name}).pipe(
                            Stream.tap(_ =>
                                repository.insertTestResult(_, testRun),
                            ),
                            Stream.runDrain,
                        );

                        const junctionAfter =
                            (yield* getAllTestRunResults).filter(
                                j => j.testRun === testRun.id,
                            );
                        t.expect(junctionAfter).toHaveLength(
                            junctionBefore.length,
                        );

                        const scopedAgain = yield* scopeToRun;
                        t.expect(scopedAgain).toHaveLength(testCases.length);

                        const allResults = yield* getAllTestResults;
                        const scopedIds = new Set(scoped.map(r => r.id));
                        const scopedAgainIds = new Set(
                            scopedAgain.map(r => r.id),
                        );
                        t.expect(
                            [...scopedAgainIds].sort((a, b) =>
                                String(a).localeCompare(String(b)),
                            ),
                        ).toEqual(
                            [...scopedIds].sort((a, b) =>
                                String(a).localeCompare(String(b)),
                            ),
                        );
                        t.expect(
                            allResults.filter(r => scopedIds.has(r.id)),
                        ).toHaveLength(testCases.length);
                    }),
            );

            it.effect(
                'stores siblings with equal values and decodes projected values with their schemas',
                () =>
                    Effect.gen(function* () {
                        const repository = yield* TestRepository;
                        const run = yield* repository.getOrCreateCurrentTestRun(
                            'suite-projected-siblings',
                        );
                        const budget: Test.TestResult<
                            {transcript: string},
                            {value: number},
                            number
                        > = {
                            id: 'projected-budget',
                            hashTestCase: 'projected-case',
                            key: 'budget',
                            ordering: 0,
                            resultOrdering: 0,
                            input: {transcript: 'A call about BANT.'},
                            result: {value: 50_000},
                            expected: 50_000,
                            label: 'TP',
                            tags: ['bant'],
                            timeMillis: 12.5,
                        };
                        const need = {
                            ...budget,
                            id: 'projected-need',
                            key: 'need',
                            resultOrdering: 1,
                        };
                        yield* repository.insertTestResults(
                            [need, budget],
                            run,
                        );

                        const actual = yield* repository
                            .getTestResultsStream(run, {
                                input: Schema.Struct({
                                    transcript: Schema.String,
                                }),
                                result: Schema.Struct({value: Schema.Finite}),
                                expected: Schema.Finite,
                            })
                            .pipe(Stream.runCollect);

                        t.expect(actual).toEqual([budget, need]);
                    }),
            );

            it.effect(
                'keeps case order, sibling order and inference timing for each run when result IDs are reused',
                () =>
                    Effect.gen(function* () {
                        const repository = yield* TestRepository;
                        const name = 'suite-run-metadata';
                        const firstRun =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        const budget: Test.TestResult<string, string, string> =
                            {
                                id: 'run-metadata-budget',
                                hashTestCase: 'run-metadata-first-case',
                                key: 'budget',
                                ordering: 0,
                                resultOrdering: 0,
                                input: 'First call',
                                result: 'yes',
                                expected: 'yes',
                                label: 'TP',
                                tags: [],
                                timeMillis: 10,
                            };
                        const need = {
                            ...budget,
                            id: 'run-metadata-need',
                            key: 'need',
                            resultOrdering: 1,
                        };
                        const other = {
                            ...budget,
                            id: 'run-metadata-other',
                            hashTestCase: 'run-metadata-second-case',
                            ordering: 1,
                            input: 'Second call',
                            timeMillis: 20,
                        };
                        yield* repository.insertTestResults(
                            [other, need, budget],
                            firstRun,
                        );
                        yield* repository.commitCurrentTestRun({
                            name,
                            hash: 'run-metadata-first',
                        });

                        const secondRun =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        const secondBudget = {
                            ...budget,
                            ordering: 1,
                            resultOrdering: 1,
                            timeMillis: 40,
                        };
                        const secondNeed = {
                            ...need,
                            ordering: 1,
                            resultOrdering: 0,
                            timeMillis: 40,
                        };
                        const secondOther = {
                            ...other,
                            ordering: 0,
                            timeMillis: 30,
                        };
                        yield* repository.insertTestResults(
                            [secondBudget, secondNeed, secondOther],
                            secondRun,
                        );

                        const firstResults = yield* repository
                            .getTestResultsStream(firstRun)
                            .pipe(Stream.runCollect);
                        const secondResults = yield* repository
                            .getTestResultsStream(secondRun)
                            .pipe(Stream.runCollect);

                        t.expect(firstResults).toEqual([budget, need, other]);
                        t.expect(secondResults).toEqual([
                            secondOther,
                            secondNeed,
                            secondBudget,
                        ]);
                    }),
            );

            it.effect(
                'clearStale: keeps `keep` most recent commits, prunes orphans, leaves other suites alone',
                () =>
                    Effect.gen(function* () {
                        const other = 'clearStale-other';
                        const target = 'clearStale-target';
                        const repository = yield* TestRepository;

                        // Use inputs unique to this test so pruned results are truly
                        // orphaned and get cleaned up.
                        const otherInput = 799;
                        const targetInputs = [751, 752, 753] as const;

                        const otherRun =
                            yield* repository.getOrCreateCurrentTestRun(other);
                        yield* T.all({
                            testCases: [
                                {input: otherInput, expected: otherInput + 1},
                            ],
                            program: add,
                            name: other,
                        }).pipe(
                            Stream.tap(_ =>
                                repository.insertTestResult(_, otherRun),
                            ),
                            Stream.runDrain,
                        );
                        yield* repository.commitCurrentTestRun({
                            name: other,
                            hash: `${other}-1`,
                        });

                        for (const input of targetInputs) {
                            const targetRun =
                                yield* repository.getOrCreateCurrentTestRun(
                                    target,
                                );
                            yield* T.all({
                                testCases: [{input, expected: input + 1}],
                                program: add,
                                name: target,
                            }).pipe(
                                Stream.tap(_ =>
                                    repository.insertTestResult(_, targetRun),
                                ),
                                Stream.runDrain,
                            );
                            yield* repository.commitCurrentTestRun({
                                name: target,
                                hash: `${target}-${input}`,
                            });
                        }

                        yield* repository.clearStale({name: target, keep: 1});

                        const runs = yield* getAllTestRuns;
                        const targetHashes = new Set(
                            runs
                                .filter(r => r.name === target)
                                .map(r => r.hash),
                        );
                        t.expect(targetHashes).toEqual(
                            new Set([null, `${target}-${targetInputs[2]}`]),
                        );

                        const otherHashes = new Set(
                            runs.filter(r => r.name === other).map(r => r.hash),
                        );
                        t.expect(otherHashes).toEqual(
                            new Set([null, `${other}-1`]),
                        );

                        // Verify orphan cleanup via the junction table. We check the
                        // target suite's kept run only has 1 associated result, and
                        // the pruned inputs (751, 752) are no longer referenced by
                        // any surviving run.
                        const allRunResults = yield* getAllTestRunResults;
                        const keptTargetRun = runs.find(
                            r =>
                                r.name === target &&
                                r.hash === `${target}-${targetInputs[2]}`,
                        );
                        t.expect(keptTargetRun).toBeDefined();
                        const keptAssociations = allRunResults.filter(
                            rr => rr.testRun === keptTargetRun?.id,
                        );
                        t.expect(keptAssociations).toHaveLength(1);

                        // Pruned target run IDs must not appear in the junction table.
                        const survivingRunIds = new Set(runs.map(r => r.id));
                        t.expect(
                            allRunResults.every(rr =>
                                survivingRunIds.has(rr.testRun),
                            ),
                        ).toBe(true);

                        // Verify orphaned test-results rows (inputs 751, 752) were
                        // pruned by the final DELETE in clearStale. Scope to results
                        // referenced by the target/other suite runs — the shared
                        // in-memory DB also holds rows from other tests.
                        const allResults = yield* getAllTestResults;
                        const myRunIds = new Set(
                            runs
                                .filter(
                                    r => r.name === target || r.name === other,
                                )
                                .map(r => r.id),
                        );
                        const myResultIds = new Set(
                            allRunResults
                                .filter(rr => myRunIds.has(rr.testRun))
                                .map(rr => rr.testResult),
                        );
                        const inputs = allResults
                            .filter(r => myResultIds.has(r.id))
                            .map(r => r.input)
                            .filter((x): x is number => typeof x === 'number');
                        t.expect(new Set(inputs)).toEqual(
                            new Set<number>([otherInput, targetInputs[2]]),
                        );

                        // The orphaned inputs must not survive anywhere in test-results
                        // either — the final DELETE prunes rows no run references.
                        const allInputs = new Set(
                            allResults
                                .map(r => r.input)
                                .filter(
                                    (x): x is number => typeof x === 'number',
                                ),
                        );
                        t.expect(allInputs.has(targetInputs[0])).toBe(false);
                        t.expect(allInputs.has(targetInputs[1])).toBe(false);
                    }),
            );

            it.effect(
                'getOrCreateCurrentTestRun returns a decoded TestRun instance and is idempotent for the same name',
                () =>
                    Effect.gen(function* () {
                        const name = 'suite-get-or-create-idempotent';
                        const repository = yield* TestRepository;

                        const a =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        const b =
                            yield* repository.getOrCreateCurrentTestRun(name);

                        t.expect(a).toBeInstanceOf(TestRun);
                        t.expect(b.id).toBe(a.id);
                        t.expect(b.hash).toBeNull();

                        const runs = (yield* getAllTestRuns).filter(
                            r => r.name === name,
                        );
                        const current = runs.filter(r => r.hash === null);
                        t.expect(current).toHaveLength(1);
                    }),
            );

            it.effect(
                'clearUncommitedTestResults is a no-op when no current run exists for the suite name',
                () =>
                    Effect.gen(function* () {
                        const repository = yield* TestRepository;
                        const exit = yield* Effect.exit(
                            repository.clearUncommitedTestResults({
                                name: 'suite-never-created',
                            }),
                        );
                        t.expect(Exit.isSuccess(exit)).toBe(true);
                    }),
            );

            it.effect(
                'clearStale is a no-op when there are fewer committed runs than `keep`',
                () =>
                    Effect.gen(function* () {
                        const name = 'suite-few-runs';
                        const repository = yield* TestRepository;
                        const testRun =
                            yield* repository.getOrCreateCurrentTestRun(name);
                        yield* T.all({
                            testCases: [{input: 601, expected: 602}],
                            program: add,
                            name,
                        }).pipe(
                            Stream.tap(_ =>
                                repository.insertTestResult(_, testRun),
                            ),
                            Stream.runDrain,
                        );
                        yield* repository.commitCurrentTestRun({
                            name,
                            hash: `${name}-1`,
                        });

                        const before = (yield* getAllTestRuns).filter(
                            r => r.name === name,
                        );
                        yield* repository.clearStale({name, keep: 3});
                        const after = (yield* getAllTestRuns).filter(
                            r => r.name === name,
                        );
                        t.expect(
                            after
                                .map(r => r.hash)
                                .sort((a, b) =>
                                    String(a).localeCompare(String(b)),
                                ),
                        ).toEqual(
                            before
                                .map(r => r.hash)
                                .sort((a, b) =>
                                    String(a).localeCompare(String(b)),
                                ),
                        );
                    }),
            );
        },
    );

    t.it.effect(
        'opening an old database fails without changing its saved runs',
        () =>
            Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* sql`
                CREATE TABLE ${sql(TR.tables.testRuns)}(
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT
                );
            `;
                yield* sql`INSERT INTO ${sql(TR.tables.testRuns)} ${sql.insert({id: 1, name: 'old', hash: 'baseline'})};`;
                const exit = yield* TR.makeTestRepository.pipe(Effect.exit);
                t.expect({
                    failed: Exit.isFailure(exit),
                    saved: yield* sql`SELECT * FROM ${sql(TR.tables.testRuns)};`,
                }).toEqual({
                    failed: true,
                    saved: [{id: 1, name: 'old', hash: 'baseline'}],
                });
            }).pipe(
                Effect.provide(
                    Sqlite.SqliteClient.layer({filename: ':memory:'}),
                ),
            ),
    );

    t.it.effect(
        'reopening a current database preserves completed results',
        () =>
            Effect.gen(function* () {
                const repository = yield* TR.makeTestRepository;
                const run =
                    yield* repository.getOrCreateCurrentTestRun('reopen');
                const result: Test.TestResult = {
                    id: 'saved-result',
                    hashTestCase: 'saved-case',
                    key: 'result',
                    ordering: 7,
                    resultOrdering: 3,
                    input: 1,
                    result: 2,
                    expected: 2,
                    label: 'TP',
                    tags: ['a,b', '', '日本語'],
                    timeMillis: 42.5,
                };
                yield* repository.withTestRun(
                    run,
                    repository.insertTestResult(result, run),
                );
                const reopened = yield* TR.makeTestRepository;
                t.expect({
                    results: yield* reopened
                        .getTestResultsStream(run)
                        .pipe(Stream.runCollect),
                    complete: yield* reopened.isComplete(run),
                }).toEqual({results: [result], complete: true});
            }).pipe(
                Effect.provide(
                    Sqlite.SqliteClient.layer({filename: ':memory:'}),
                ),
            ),
    );

    // Keep the malformed row out of the shared database used by the other tests.
    t.layer(TestRepository.TestLayer, {excludeTestServices: true})(
        'with isolated in-memory db (bogus row)',
        it => {
            it.effect(
                'reading saved results surfaces SchemaError on a bogus label row',
                () =>
                    Effect.gen(function* () {
                        const sql = yield* SqlClient.SqlClient;
                        const repository = yield* TestRepository;
                        const run =
                            yield* repository.getOrCreateCurrentTestRun(
                                'bogus',
                            );

                        yield* sql`
                        INSERT INTO ${sql(TR.tables.testResults)}
                        ${sql.insert({
                            id: 'bogus',
                            hashTestCase: 'bogus',
                            key: 'result',
                            ordering: 0,
                            resultOrdering: 0,
                            input: 'null',
                            result: 'null',
                            expected: 'null',
                            label: 'NOT_A_LABEL',
                            tags: '[]',
                            timeMillis: 0,
                        })};
                    `;
                        yield* sql`
                            INSERT INTO ${sql(TR.tables.testRunResults)}
                            ${sql.insert({testRun: run.id, testResult: 'bogus', ordering: 0, resultOrdering: 0, timeMillis: 0, tags: '[]'})};
                        `;

                        const exit = yield* Effect.exit(
                            repository
                                .getTestResultsStream(run)
                                .pipe(Stream.runDrain),
                        );
                        t.expect(Exit.isFailure(exit)).toBe(true);
                        const err = Exit.isFailure(exit)
                            ? Cause.findErrorOption(exit.cause).pipe(
                                  Option.getOrThrow,
                              )
                            : null;
                        t.expect(err).toBeInstanceOf(Schema.SchemaError);
                    }),
            );
        },
    );

    t.layer(TestRepository.TestLayer, {excludeTestServices: true})(
        'with isolated in-memory db (write failure)',
        it => {
            it.effect(
                'insertTestResult surfaces SqlError when the table is dropped',
                () =>
                    Effect.gen(function* () {
                        const sql = yield* SqlClient.SqlClient;
                        const repository = yield* TestRepository;
                        const name = 'suite-write-failure';

                        const testRun =
                            yield* repository.getOrCreateCurrentTestRun(name);

                        // Force subsequent writes to fail.
                        yield* sql`DROP TABLE ${sql(TR.tables.testResults)};`;

                        const sample: Test.TestResult<number, number, number> =
                            {
                                id: 'x',
                                hashTestCase: 'x',
                                key: 'result',
                                ordering: 0,
                                resultOrdering: 0,
                                input: 1,
                                result: 1,
                                expected: 1,
                                label: 'TP',
                                tags: [],
                                timeMillis: 0,
                            };

                        const exit = yield* Effect.exit(
                            repository.insertTestResult(sample, testRun),
                        );
                        t.expect(Exit.isFailure(exit)).toBe(true);
                        const err = Exit.isFailure(exit)
                            ? Cause.findErrorOption(exit.cause).pipe(
                                  Option.getOrThrow,
                              )
                            : null;
                        t.expect(err).toBeInstanceOf(SqlError);
                    }),
            );
        },
    );
});

t.it.effect.each([
    {
        description: 'commas, empty tags, whitespace and Unicode',
        tags: ['a,b', '', ' de ', '日本語'],
    },
    {description: 'an empty tag list', tags: []},
])('preserves $description separately for each run', ({tags}) =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const firstRun = yield* repository.getOrCreateCurrentTestRun('tags');
        const first: Test.TestResult<number, number, number> = {
            id: 'same-result',
            hashTestCase: 'same-case',
            key: 'result',
            ordering: 0,
            resultOrdering: 0,
            label: 'TP',
            input: 1,
            result: 1,
            expected: 1,
            tags,
            timeMillis: 1,
        };
        yield* repository.insertTestResult(first, firstRun);
        yield* repository.commitCurrentTestRun({
            name: 'tags',
            hash: 'baseline',
        });
        const secondRun = yield* repository.getOrCreateCurrentTestRun('tags');
        const second = {...first, tags: ['new,tag'], timeMillis: 2};
        yield* repository.insertTestResult(second, secondRun);

        const firstSaved = yield* repository
            .getTestResultsStream(firstRun)
            .pipe(Stream.runCollect);
        const secondSaved = yield* repository
            .getTestResultsStream(secondRun)
            .pipe(Stream.runCollect);
        t.expect([firstSaved, secondSaved]).toEqual([[first], [second]]);
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

t.it.effect('a failed commit leaves the previous run state intact', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const sql = yield* SqlClient.SqlClient;
        const run = yield* repository.getOrCreateCurrentTestRun('atomic');
        yield* T.all({
            name: 'atomic',
            testCases: [{input: 1, expected: 2}],
            program: add,
        }).pipe(
            Stream.tap(result => repository.insertTestResult(result, run)),
            Stream.runDrain,
        );
        const before = yield* getAllTestRuns;
        yield* sql`
            CREATE TRIGGER reject_next_run BEFORE INSERT ON ${sql(TR.tables.testRuns)}
            WHEN NEW.name = 'atomic'
            BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END;
        `;

        const error = yield* repository
            .commitCurrentTestRun({
                name: 'atomic',
                hash: 'new-baseline',
            })
            .pipe(Effect.flip);
        t.expect({
            error: error._tag,
            runs: yield* getAllTestRuns,
            baseline: yield* repository.getLastTestRunHash('atomic'),
        }).toEqual({
            error: 'SqlError',
            runs: before,
            baseline: Option.none(),
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

t.it.effect('a stale run cannot replace the current results', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const previous = yield* repository.getOrCreateCurrentTestRun('stale');
        const results = yield* T.all({
            name: 'stale',
            testCases: [{input: 1, expected: 2}],
            program: add,
        }).pipe(Stream.runCollect);
        yield* repository.insertTestResults(results, previous);
        yield* repository.commitCurrentTestRun({
            name: 'stale',
            hash: 'baseline',
        });
        const current = yield* repository.getOrCreateCurrentTestRun('stale');
        yield* repository.insertTestResults(results, current);

        const exit = yield* repository
            .withTestRun(previous, Effect.void)
            .pipe(Effect.exit);
        t.expect({
            rejected: Exit.isFailure(exit),
            baselineComplete: yield* repository.isComplete(previous),
            currentResults: yield* repository
                .getTestResultsStream(current)
                .pipe(Stream.runCollect),
        }).toEqual({
            rejected: true,
            baselineComplete: true,
            currentResults: results,
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

t.it.effect(
    'pages tied ordering values without losing results and decodes only requested pages',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const sql = yield* SqlClient.SqlClient;
            const run = yield* repository.getOrCreateCurrentTestRun('pages');
            const results: Test.TestResult<number, number, number>[] =
                Array.from({length: 205}, (_, index) => ({
                    id: String(index).padStart(3, '0'),
                    hashTestCase: `case-${index}`,
                    key: 'result',
                    ordering: Math.floor(index / 110),
                    resultOrdering: 0,
                    label: 'TP',
                    input: index,
                    result: index,
                    expected: index,
                    tags: [],
                    timeMillis: 1,
                }));
            yield* repository.insertTestResults(results.toReversed(), run);
            t.expect(
                yield* repository
                    .getTestResultsStream(run)
                    .pipe(Stream.runCollect),
            ).toEqual(results);

            yield* sql`UPDATE ${sql(TR.tables.testResults)} SET result = 'invalid json' WHERE id = '204';`;
            t.expect(
                yield* repository
                    .getTestResultsStream(run)
                    .pipe(Stream.take(1), Stream.runCollect),
            ).toEqual(results.slice(0, 1));
            const error = yield* repository
                .getTestResultsStream(run)
                .pipe(Stream.runDrain, Effect.flip);
            t.expect(error._tag).toBe('SchemaError');
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);
