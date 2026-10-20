import {NodeFileSystem} from '@effect/platform-node';
import * as Sqlite from '@effect/sql-sqlite-node';
import {expect, it} from '@effect/vitest';
import {
    Cause,
    Deferred,
    Effect,
    Exit,
    Fiber,
    FileSystem,
    Option,
    Schema,
    Stream,
} from 'effect';
import {SqlClient} from 'effect/sql';

import {Stats} from '../Classify.js';
import type {TestResult} from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {TestRun} from '../TestRun.js';
import {makeTestRepository, tables} from './Test.repository.sqlite.js';
import {
    getAllTestResults,
    getAllTestRunResults,
    getAllTestRuns,
} from './test-repository-fixtures.js';

const numberSchemas = {
    testCase: {input: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};

const result = (
    value: number,
    overrides: Partial<TestResult<number, number, number>> = {},
): TestResult<number, number, number> => ({
    id: `result-${value}`,
    hashTestCase: `case-${value}`,
    key: 'result',
    ordering: value,
    resultOrdering: 0,
    input: value,
    result: value,
    expected: value,
    label: 'TP',
    tags: [],
    timeMillis: value + 1,
    ...overrides,
});

it.effect('lookups never create missing runs or baselines', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const input = {name: 'missing', variant: 'A'};
        expect({
            exact: yield* repository.getTestRun(10),
            latest: yield* repository.getLatestTestRun(input),
            baseline: yield* repository.getBaselineTestRun(input),
            variants: yield* repository.listVariantBaselines(input.name),
            runs: yield* repository.listTestRuns({...input, limit: 50}),
            saved: yield* getAllTestRuns,
        }).toEqual({
            exact: Option.none(),
            latest: Option.none(),
            baseline: Option.none(),
            variants: [],
            runs: [],
            saved: [],
        });
        expect(
            yield* repository.commitTestRun(10).pipe(Effect.flip),
        ).toMatchObject({
            _tag: 'TestRunNotFound',
            testRunId: 10,
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect.each([false, true])(
    'finishes and commits a successful run (empty: %s)',
    empty =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const saved = yield* repository.withTestRun(
                {name: 'success', variant: 'A'},
                run =>
                    Effect.gen(function* () {
                        expect(run).toBeInstanceOf(TestRun);
                        expect(run.state).toBe('Running');
                        expect(yield* repository.getTestRun(run.id)).toEqual(
                            Option.some(run),
                        );
                        if (!empty)
                            yield* repository.insertTestResult(
                                result(1),
                                run,
                                numberSchemas,
                            );
                        return 'callback-value';
                    }),
            );
            yield* repository.commitTestRun(saved.run.id);
            yield* repository.commitTestRun(saved.run.id);
            expect({
                state: saved.run.state,
                value: saved.value,
                baseline: yield* repository.getBaselineTestRun(saved.run),
                rows: yield* repository
                    .getTestResultsStream(saved.run, numberSchemas)
                    .pipe(Stream.runCollect),
                runs: yield* getAllTestRuns,
            }).toEqual({
                state: 'Complete',
                value: 'callback-value',
                baseline: Option.some(saved.run),
                rows: empty ? [] : [result(1)],
                runs: [saved.run],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect.each(['failure', 'defect'] as const)(
    'keeps saved batches and marks a callback %s Failed',
    outcome =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const problem = new Error('program failed');
            const saved = Array.from({length: 55}, (_, index) => result(index));
            const exit = yield* repository
                .withTestRun({name: 'failure', variant: 'A'}, run =>
                    repository
                        .insertTestResults(saved, run, numberSchemas)
                        .pipe(
                            Effect.andThen(
                                outcome === 'failure'
                                    ? Effect.fail(problem)
                                    : Effect.die(problem),
                            ),
                        ),
                )
                .pipe(Effect.exit);
            const run = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'failure',
                    variant: 'A',
                }),
            );
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
                expect(exit.cause.reasons).toEqual([
                    expect.objectContaining(
                        outcome === 'failure'
                            ? {_tag: 'Fail', error: problem}
                            : {_tag: 'Die', defect: problem},
                    ),
                ]);
            }
            expect({
                state: run.state,
                rows: yield* repository
                    .getTestResultsStream(run, numberSchemas)
                    .pipe(Stream.runCollect),
                commit: yield* repository
                    .commitTestRun(run.id)
                    .pipe(Effect.flip),
            }).toEqual({
                state: 'Failed',
                rows: saved,
                commit: expect.objectContaining({
                    _tag: 'TestRunIncomplete',
                    testSuiteName: 'failure',
                    testRunId: run.id,
                    variant: 'A',
                }),
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('marks a synchronous callback throw Failed', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const problem = new Error('callback threw');
        const exit = yield* repository
            .withTestRun({name: 'throw', variant: 'A'}, () => {
                throw problem;
            })
            .pipe(Effect.exit);
        const run = Option.getOrThrow(
            yield* repository.getLatestTestRun({name: 'throw', variant: 'A'}),
        );
        expect({
            state: run.state,
            reasons: Exit.isFailure(exit) ? exit.cause.reasons : [],
            commit: (yield* repository.commitTestRun(run.id).pipe(Effect.flip))
                ._tag,
        }).toEqual({
            state: 'Failed',
            reasons: [expect.objectContaining({_tag: 'Die', defect: problem})],
            commit: 'TestRunIncomplete',
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('interruption keeps saved results and marks the run Failed', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const started = yield* Deferred.make<TestRun>();
        const fiber = yield* Effect.forkChild(
            repository.withTestRun({name: 'interrupt', variant: 'A'}, run =>
                repository
                    .insertTestResult(result(2), run, numberSchemas)
                    .pipe(
                        Effect.andThen(Deferred.succeed(started, run)),
                        Effect.andThen(Effect.never),
                    ),
            ),
        );
        const running = yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const saved = Option.getOrThrow(
            yield* repository.getTestRun(running.id),
        );
        expect({
            state: saved.state,
            rows: yield* repository
                .getTestResultsStream(saved, numberSchemas)
                .pipe(Stream.runCollect),
            commit: (yield* repository
                .commitTestRun(saved.id)
                .pipe(Effect.flip))._tag,
        }).toEqual({
            state: 'Failed',
            rows: [result(2)],
            commit: 'TestRunIncomplete',
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('failed creation does not invoke the callback', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
            CREATE TRIGGER reject_creation BEFORE INSERT ON ${sql(tables.testRuns)}
            BEGIN SELECT RAISE(ABORT, 'forced creation failure'); END;
        `;
        let called = false;
        const error = yield* repository
            .withTestRun({name: 'creation', variant: 'A'}, () => {
                called = true;
                return Effect.void;
            })
            .pipe(Effect.flip);
        expect({
            error: error._tag,
            called,
            rows: yield* getAllTestRuns,
        }).toEqual({
            error: 'SqlError',
            called: false,
            rows: [],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect.each(['success', 'failure', 'defect'] as const)(
    'propagates failed final-state writes after callback %s',
    outcome =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
            CREATE TRIGGER reject_completion BEFORE UPDATE OF state ON ${sql(tables.testRuns)}
            BEGIN SELECT RAISE(ABORT, 'forced completion failure'); END;
        `;
            const problem = new Error('execution failure');
            let calls = 0;
            const exit = yield* repository
                .withTestRun({name: 'finalization', variant: 'A'}, run => {
                    calls++;
                    return repository
                        .insertTestResult(result(3), run, numberSchemas)
                        .pipe(
                            Effect.andThen(
                                outcome === 'success'
                                    ? Effect.succeed('done')
                                    : outcome === 'failure'
                                      ? Effect.fail(problem)
                                      : Effect.die(problem),
                            ),
                        );
                })
                .pipe(Effect.exit);
            const run = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'finalization',
                    variant: 'A',
                }),
            );
            expect(Exit.isFailure(exit)).toBe(true);
            if (Exit.isFailure(exit)) {
                const reasons = exit.cause.reasons;
                expect(reasons).toContainEqual(
                    expect.objectContaining({
                        _tag: 'Fail',
                        error: expect.objectContaining({_tag: 'SqlError'}),
                    }),
                );
                expect(reasons).toHaveLength(outcome === 'success' ? 1 : 2);
                if (outcome !== 'success') {
                    expect(reasons).toContainEqual(
                        expect.objectContaining(
                            outcome === 'failure'
                                ? {_tag: 'Fail', error: problem}
                                : {_tag: 'Die', defect: problem},
                        ),
                    );
                }
            }
            expect({
                calls,
                state: run.state,
                rows: yield* repository
                    .getTestResultsStream(run, numberSchemas)
                    .pipe(Stream.runCollect),
                commit: (yield* repository
                    .commitTestRun(run.id)
                    .pipe(Effect.flip))._tag,
            }).toEqual({
                calls: 1,
                state: 'Running',
                rows: [result(3)],
                commit: 'TestRunIncomplete',
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('overlapping attempts finish independently in reverse order', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const firstStarted = yield* Deferred.make<TestRun>();
        const secondStarted = yield* Deferred.make<TestRun>();
        const finishFirst = yield* Deferred.make<void>();
        const finishSecond = yield* Deferred.make<void>();
        const selection = {name: 'overlap', variant: 'A'};
        const first = yield* Effect.forkChild(
            repository.withTestRun(selection, run =>
                repository
                    .insertTestResult(result(1), run, numberSchemas)
                    .pipe(
                        Effect.andThen(Deferred.succeed(firstStarted, run)),
                        Effect.andThen(Deferred.await(finishFirst)),
                    ),
            ),
        );
        const firstRunning = yield* Deferred.await(firstStarted);
        const second = yield* Effect.forkChild(
            repository.withTestRun(selection, run =>
                repository
                    .insertTestResult(result(2), run, numberSchemas)
                    .pipe(
                        Effect.andThen(Deferred.succeed(secondStarted, run)),
                        Effect.andThen(Deferred.await(finishSecond)),
                    ),
            ),
        );
        const secondRunning = yield* Deferred.await(secondStarted);
        expect(secondRunning.id).toBeGreaterThan(firstRunning.id);
        yield* Deferred.succeed(finishSecond, undefined);
        const secondSaved = yield* Fiber.join(second);
        expect({
            first: Option.getOrThrow(
                yield* repository.getTestRun(firstRunning.id),
            ).state,
            second: secondSaved.run.state,
            latest: yield* repository.getLatestTestRun(selection),
        }).toEqual({
            first: 'Running',
            second: 'Complete',
            latest: Option.some(secondSaved.run),
        });
        yield* Deferred.succeed(finishFirst, undefined);
        const firstSaved = yield* Fiber.join(first);
        yield* repository.commitTestRun(firstSaved.run.id);
        expect({
            baseline: yield* repository.getBaselineTestRun(selection),
            latest: yield* repository.getLatestTestRun(selection),
            first: yield* repository
                .getTestResultsStream(firstSaved.run, numberSchemas)
                .pipe(Stream.runCollect),
            second: yield* repository
                .getTestResultsStream(secondSaved.run, numberSchemas)
                .pipe(Stream.runCollect),
        }).toEqual({
            baseline: Option.some(firstSaved.run),
            latest: Option.some(secondSaved.run),
            first: [result(1)],
            second: [result(2)],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'keeps independent baselines and all results after reopening the database',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const database = `${directory}/runs.sqlite`;
            const runs = yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const saved = yield* Effect.forEach(
                    ['A', 'B', 'C', 'A', 'B', 'C'],
                    (variant, index) =>
                        repository
                            .withTestRun({name: 'history', variant}, run =>
                                repository.insertTestResult(
                                    result(index),
                                    run,
                                    numberSchemas,
                                ),
                            )
                            .pipe(Effect.map(({run}) => run)),
                );
                yield* repository.commitTestRun(saved[3].id);
                yield* repository.commitTestRun(saved[4].id);
                yield* repository.commitTestRun(saved[2].id);
                yield* repository.commitTestRun(saved[0].id);
                yield* repository.commitTestRun(saved[0].id);
                return saved;
            }).pipe(Effect.provide(TestRepository.layer(database)));
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                expect({
                    baselines:
                        yield* repository.listVariantBaselines('history'),
                    runs: (yield* repository.listTestRuns({
                        name: 'history',
                        limit: 100,
                    })).map(({id, isBaseline}) => ({id, isBaseline})),
                    results: yield* Effect.forEach(runs, run =>
                        repository
                            .getTestResultsStream(run, numberSchemas)
                            .pipe(Stream.runCollect),
                    ),
                }).toEqual({
                    baselines: [
                        {variant: 'A', baseline: Option.some(runs[0])},
                        {variant: 'B', baseline: Option.some(runs[4])},
                        {variant: 'C', baseline: Option.some(runs[2])},
                    ],
                    runs: runs.toReversed().map(run => ({
                        id: run.id,
                        isBaseline: [
                            runs[0].id,
                            runs[4].id,
                            runs[2].id,
                        ].includes(run.id),
                    })),
                    results: runs.map((_, index) => [result(index)]),
                });
            }).pipe(Effect.provide(TestRepository.layer(database)));
        }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
);

it.effect.each(['Complete', 'Failed'] as const)(
    'refuses result writes to %s runs without changing values, tags, or times',
    state =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const original = result(1, {
                tags: ['a,b', '', ' de ', '日本語'],
                timeMillis: 42.5,
            });
            yield* repository
                .withTestRun({name: 'immutable', variant: 'A'}, run =>
                    repository
                        .insertTestResult(original, run, numberSchemas)
                        .pipe(
                            Effect.andThen(
                                state === 'Complete'
                                    ? Effect.void
                                    : Effect.fail('failed'),
                            ),
                        ),
                )
                .pipe(Effect.exit);
            const saved = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'immutable',
                    variant: 'A',
                }),
            );
            const before = yield* getAllTestRunResults;
            const exit = yield* repository
                .insertTestResults(
                    [
                        {
                            ...original,
                            tags: ['changed'],
                            ordering: 10,
                            timeMillis: 99,
                        },
                        result(2),
                    ],
                    new TestRun({
                        id: saved.id,
                        name: saved.name,
                        variant: saved.variant,
                        state: 'Running',
                    }),
                    numberSchemas,
                )
                .pipe(Effect.exit);
            const emptyWrite = yield* repository
                .insertTestResults([], saved, numberSchemas)
                .pipe(Effect.exit);
            expect({
                rejected: Exit.isFailure(exit),
                emptyRejected: Exit.isFailure(emptyWrite),
                state: Option.getOrThrow(yield* repository.getTestRun(saved.id))
                    .state,
                results: yield* repository
                    .getTestResultsStream(saved, numberSchemas)
                    .pipe(Stream.runCollect),
                links: yield* getAllTestRunResults,
                contentCount: (yield* getAllTestResults).length,
            }).toEqual({
                rejected: true,
                emptyRejected: true,
                state,
                results: [original],
                links: before,
                contentCount: 1,
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'shares result content while retaining each run’s ordering, tags, and times',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const first = result(1, {
                tags: ['a,b', '', '日本語'],
                ordering: 7,
                resultOrdering: 3,
                timeMillis: 42.5,
            });
            const second = {
                ...first,
                tags: [],
                ordering: 1,
                resultOrdering: 0,
                timeMillis: 5,
            };
            const saved = yield* Effect.forEach([first, second], (row, index) =>
                repository.withTestRun(
                    {name: 'shared', variant: index === 0 ? 'A' : 'B'},
                    run =>
                        repository
                            .insertTestResult(row, run, numberSchemas)
                            .pipe(
                                Effect.andThen(
                                    repository.insertTestResult(
                                        row,
                                        run,
                                        numberSchemas,
                                    ),
                                ),
                            ),
                ),
            );
            expect({
                contentCount: (yield* getAllTestResults).length,
                linkCount: (yield* getAllTestRunResults).length,
                first: yield* repository
                    .getTestResultsStream(saved[0].run, numberSchemas)
                    .pipe(Stream.runCollect),
                second: yield* repository
                    .getTestResultsStream(saved[1].run, numberSchemas)
                    .pipe(Stream.runCollect),
            }).toEqual({
                contentCount: 1,
                linkCount: 2,
                first: [first],
                second: [second],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'serialization failure keeps earlier batches and fails the attempt',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const rows = Array.from({length: 51}, (_, index) => result(index));
            rows[50] = result(50, {result: Number.NaN});
            const error = yield* repository
                .withTestRun({name: 'encoding', variant: 'A'}, run =>
                    repository.insertTestResults(rows, run, numberSchemas),
                )
                .pipe(Effect.flip);
            const saved = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'encoding',
                    variant: 'A',
                }),
            );
            expect({
                error,
                state: saved.state,
                rows: yield* repository
                    .getTestResultsStream(saved, numberSchemas)
                    .pipe(Stream.runCollect),
            }).toEqual({
                error: expect.objectContaining({
                    _tag: 'TestValueError',
                    suite: 'encoding',
                    caseNumber: 51,
                    key: 'result',
                    field: 'evaluation.result',
                    operation: 'encode',
                    cause: expect.objectContaining({_tag: 'SchemaError'}),
                }),
                state: 'Failed',
                rows: rows.slice(0, 50),
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('a failed batch rolls back its content and links', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
            CREATE TRIGGER reject_link BEFORE INSERT ON ${sql(tables.testRunResults)}
            WHEN NEW.testResult = 'result-2'
            BEGIN SELECT RAISE(ABORT, 'forced link failure'); END;
        `;
        const error = yield* repository
            .withTestRun({name: 'atomic-batch', variant: 'A'}, run =>
                repository.insertTestResults(
                    [result(1), result(2)],
                    run,
                    numberSchemas,
                ),
            )
            .pipe(Effect.flip);
        expect({
            error: error._tag,
            state: Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: 'atomic-batch',
                    variant: 'A',
                }),
            ).state,
            contents: yield* getAllTestResults,
            links: yield* getAllTestRunResults,
        }).toEqual({
            error: 'SqlError',
            state: 'Failed',
            contents: [],
            links: [],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'a failed baseline write preserves the previous pointer and history',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const sql = yield* SqlClient.SqlClient;
            const first = yield* repository.withTestRun(
                {name: 'atomic-commit', variant: 'A'},
                () => Effect.void,
            );
            const second = yield* repository.withTestRun(
                {name: 'atomic-commit', variant: 'A'},
                () => Effect.void,
            );
            yield* repository.commitTestRun(first.run.id);
            yield* sql`
            CREATE TRIGGER reject_baseline BEFORE UPDATE ON ${sql(tables.testBaselines)}
            BEGIN SELECT RAISE(ABORT, 'forced baseline failure'); END;
        `;
            const error = yield* repository
                .commitTestRun(second.run.id)
                .pipe(Effect.flip);
            expect({
                error: error._tag,
                baseline: yield* repository.getBaselineTestRun(first.run),
                runs: yield* getAllTestRuns,
            }).toEqual({
                error: 'SqlError',
                baseline: Option.some(first.run),
                runs: [first.run, second.run],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'lists descending pages, variant filters, and optional baseline markers',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const runs = yield* Effect.forEach(
                Array.from({length: 105}, (_, index) => index),
                index =>
                    repository
                        .withTestRun(
                            {
                                name: 'pages',
                                variant: index % 2 === 0 ? 'A' : 'B',
                            },
                            () => Effect.void,
                        )
                        .pipe(Effect.map(({run}) => run)),
            );
            yield* repository.commitTestRun(runs[0].id);
            yield* repository.withTestRun(
                {name: 'other-suite', variant: 'A'},
                () => Effect.void,
            );
            const first = yield* repository.listTestRuns({
                name: 'pages',
                limit: 50,
            });
            const second = yield* repository.listTestRuns({
                name: 'pages',
                limit: 50,
                before: first[49].id,
            });
            const third = yield* repository.listTestRuns({
                name: 'pages',
                limit: 50,
                before: second[49].id,
            });
            expect({
                listed: [...first, ...second, ...third].map(({id}) => id),
                baselines: [...first, ...second, ...third]
                    .filter(run => run.isBaseline)
                    .map(({id}) => id),
                filtered: (yield* repository.listTestRuns({
                    name: 'pages',
                    variant: 'B',
                    limit: 100,
                })).map(({id}) => id),
                variants: yield* repository.listVariantBaselines('pages'),
            }).toEqual({
                listed: runs.toReversed().map(({id}) => id),
                baselines: [runs[0].id],
                filtered: runs
                    .toReversed()
                    .filter(run => run.variant === 'B')
                    .map(({id}) => id),
                variants: [
                    {variant: 'A', baseline: Option.some(runs[0])},
                    {variant: 'B', baseline: Option.none()},
                ],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect.each([0, -1, 101, 1.5, Number.NaN])(
    'rejects invalid run-list limits: %s',
    limit =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            expect(
                (yield* repository
                    .listTestRuns({name: 'limits', limit})
                    .pipe(Effect.flip))._tag,
            ).toBe('SchemaError');
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('pages tied result ordering and decodes only consumed pages', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const sql = yield* SqlClient.SqlClient;
        const results = Array.from({length: 205}, (_, index) =>
            result(index, {
                id: String(index).padStart(3, '0'),
                ordering: Math.floor(index / 110),
            }),
        );
        const {run} = yield* repository.withTestRun(
            {name: 'result-pages', variant: 'A'},
            run =>
                repository.insertTestResults(
                    results.toReversed(),
                    run,
                    numberSchemas,
                ),
        );
        expect(
            yield* repository
                .getTestResultsStream(run, numberSchemas)
                .pipe(Stream.runCollect),
        ).toEqual(results);
        expect(
            yield* repository
                .getTestResultsStream(run, numberSchemas, [
                    results[201],
                    results[2],
                ])
                .pipe(Stream.runCollect),
        ).toEqual([results[2], results[201]]);
        expect(
            yield* repository
                .getTestResultsStream(run, numberSchemas, [])
                .pipe(Stream.runCollect),
        ).toEqual([]);
        const oversized = yield* repository
            .getTestResultsStream(run, numberSchemas, results.slice(0, 51))
            .pipe(Stream.runDrain, Effect.exit);
        expect(Exit.isFailure(oversized)).toBe(true);
        yield* sql`UPDATE ${sql(tables.testResults)} SET result = 'invalid json' WHERE id = '204';`;
        expect(
            yield* repository
                .getTestResultsStream(run, numberSchemas)
                .pipe(Stream.take(1), Stream.runCollect),
        ).toEqual(results.slice(0, 1));
        expect(
            yield* repository
                .getTestResultsStream(run, numberSchemas)
                .pipe(Stream.runDrain, Effect.flip),
        ).toMatchObject({
            _tag: 'TestValueError',
            suite: 'result-pages',
            caseNumber: 2,
            key: 'result',
            field: 'evaluation.result',
            operation: 'decode',
            cause: {_tag: 'SchemaError'},
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('malformed saved labels fail with SchemaError', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const sql = yield* SqlClient.SqlClient;
        const {run} = yield* repository.withTestRun(
            {name: 'bad-label', variant: 'A'},
            run => repository.insertTestResult(result(1), run, numberSchemas),
        );
        yield* sql`UPDATE ${sql(tables.testResults)} SET label = 'NOT_A_LABEL';`;
        const exit = yield* repository
            .getTestResultsStream(run, numberSchemas)
            .pipe(Stream.runDrain, Effect.exit);
        expect(
            Exit.isFailure(exit) &&
                Option.getOrThrow(Cause.findErrorOption(exit.cause))._tag,
        ).toBe('SchemaError');
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'exact statistics count each case once across batches and release temporary tables',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const sql = yield* SqlClient.SqlClient;
            const stats = yield* repository.withStats(collector =>
                Effect.gen(function* () {
                    const cases = Array.from({length: 102}, (_, index) =>
                        result(index, {timeMillis: index + 1}),
                    );
                    yield* collector.add(cases.slice(0, 50));
                    yield* collector.add(cases.slice(50));
                    yield* collector.add(
                        cases.map(row => ({...row, label: 'FN' as const})),
                    );
                    return yield* collector.stats;
                }),
            );
            const empty = yield* repository.withStats(
                collector => collector.stats,
            );
            yield* repository
                .withStats(collector =>
                    collector
                        .add([result(1)])
                        .pipe(Effect.andThen(Effect.fail('report failed'))),
                )
                .pipe(Effect.exit);
            expect({
                stats,
                empty,
                tables: yield* sql`SELECT name FROM sqlite_temp_master WHERE name LIKE 'tots_stats_%';`,
            }).toEqual({
                stats: new Stats({
                    TP: 102,
                    TN: 0,
                    FP: 0,
                    FN: 102,
                    total: 204,
                    testCases: 102,
                    precision: 1,
                    recall: 0.5,
                    timeMin: Option.some(1),
                    timeMax: Option.some(102),
                    timeMean: Option.some(51.5),
                    timeMedian: Option.some(51.5),
                }),
                empty: Stats.empty(),
                tables: [],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('opening an old database fails without changing its saved runs', () =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE ${sql(tables.testRuns)}(id INTEGER PRIMARY KEY, name TEXT NOT NULL, hash TEXT);`;
        yield* sql`INSERT INTO ${sql(tables.testRuns)} ${sql.insert({id: 1, name: 'old', hash: 'baseline'})};`;
        const exit = yield* makeTestRepository.pipe(Effect.exit);
        expect({
            failed: Exit.isFailure(exit),
            saved: yield* sql`SELECT * FROM ${sql(tables.testRuns)};`,
        }).toEqual({
            failed: true,
            saved: [{id: 1, name: 'old', hash: 'baseline'}],
        });
    }).pipe(Effect.provide(Sqlite.SqliteClient.layer({filename: ':memory:'}))),
);
