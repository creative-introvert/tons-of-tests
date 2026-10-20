import {NodeServices} from '@effect/platform-node';
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
import {TestRepositoryStorage, tables} from './Test.repository.sqlite.js';
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
            exact: yield* repository.getTestRun({store: 'snapshot', id: 10}),
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
            yield* repository
                .commitTestRuns([
                    TestRun.make({
                        store: 'snapshot',
                        id: 10,
                        name: 'missing',
                        variant: 'A',
                        state: 'Complete',
                    }),
                ])
                .pipe(Effect.flip),
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
                        expect(run.store).toBe('cache');
                        expect(run.state).toBe('Running');
                        expect(yield* repository.getTestRun(run)).toEqual(
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
            const [snapshot] = yield* repository.commitTestRuns([saved.run]);
            expect(yield* repository.commitTestRuns([saved.run])).toEqual([
                snapshot,
            ]);
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
                baseline: Option.some(snapshot),
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
                    .commitTestRuns([run])
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
            commit: (yield* repository.commitTestRuns([run]).pipe(Effect.flip))
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
        const saved = Option.getOrThrow(yield* repository.getTestRun(running));
        expect({
            state: saved.state,
            rows: yield* repository
                .getTestResultsStream(saved, numberSchemas)
                .pipe(Stream.runCollect),
            commit: (yield* repository
                .commitTestRuns([saved])
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
                    .commitTestRuns([run])
                    .pipe(Effect.flip))._tag,
            }).toEqual({
                calls: 1,
                state: 'Running',
                rows: [result(3)],
                commit: 'TestRunIncomplete',
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect.each(['failure', 'interruption'] as const)(
    'replacing a successful attempt with %s never restores the older cache',
    outcome =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const input = {name: 'replace', variant: 'A'};
            const first = yield* repository.withTestRun(input, run =>
                repository.insertTestResult(result(1), run, numberSchemas),
            );
            const started = yield* Deferred.make<TestRun>();
            const successor = yield* Effect.forkChild(
                repository
                    .withTestRun(input, run =>
                        repository
                            .insertTestResult(result(2), run, numberSchemas)
                            .pipe(
                                Effect.andThen(Deferred.succeed(started, run)),
                                Effect.andThen(
                                    outcome === 'failure'
                                        ? Effect.fail('failed')
                                        : Effect.never,
                                ),
                            ),
                    )
                    .pipe(Effect.exit),
            );
            const running = yield* Deferred.await(started);
            if (outcome === 'interruption') yield* Fiber.interrupt(successor);
            else yield* Fiber.join(successor);
            const latest = Option.getOrThrow(
                yield* repository.getLatestTestRun(input),
            );
            expect({
                old: yield* repository.getTestRun(first.run),
                latest: {...latest, id: running.id},
                rows: yield* getAllTestResults,
                links: (yield* getAllTestRunResults).map(row => row.testRun),
                commit: (yield* repository
                    .commitTestRuns([first.run])
                    .pipe(Effect.flip))._tag,
            }).toEqual({
                old: Option.none(),
                latest: {...running, state: 'Failed'},
                rows: [expect.objectContaining({id: 'result-2'})],
                links: [running.id],
                commit: 'TestRunNotFound',
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('a replaced running attempt cannot write results or finish', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const input = {name: 'overlap', variant: 'A'};
        const started = yield* Deferred.make<TestRun>();
        const finish = yield* Deferred.make<void>();
        const first = yield* Effect.forkChild(
            repository
                .withTestRun(input, run =>
                    Deferred.succeed(started, run).pipe(
                        Effect.andThen(Deferred.await(finish)),
                    ),
                )
                .pipe(Effect.exit),
        );
        const old = yield* Deferred.await(started);
        const current = yield* repository.withTestRun(input, () => Effect.void);
        expect(
            (yield* repository
                .insertTestResult(result(1), old, numberSchemas)
                .pipe(Effect.flip))._tag,
        ).toBe('TestRunNotFound');
        yield* Deferred.succeed(finish, undefined);
        const exit = yield* Fiber.join(first);
        expect({
            finishFailed: Exit.isFailure(exit),
            latest: yield* repository.getLatestTestRun(input),
            runs: yield* getAllTestRuns,
        }).toEqual({
            finishFailed: true,
            latest: Option.some(current.run),
            runs: [current.run],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'keeps committed history and baseline selections after reopening',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: `${directory}/snapshots.sqlite`,
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: 'history',
            };
            const snapshots = yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                return yield* Effect.forEach(
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
                            .pipe(
                                Effect.flatMap(({run}) =>
                                    repository.commitTestRuns([run]),
                                ),
                                Effect.map(runs => runs[0]),
                            ),
                );
            }).pipe(Effect.provide(TestRepository.layer(options)));
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                yield* repository.commitTestRuns([
                    snapshots[0],
                    snapshots[4],
                    snapshots[2],
                ]);
                expect({
                    baselines:
                        yield* repository.listVariantBaselines('history'),
                    history: (yield* repository.listTestRuns({
                        name: 'history',
                        limit: 100,
                    })).map(({isBaseline, ...run}) => run),
                    results: yield* Effect.forEach(snapshots, run =>
                        repository
                            .getTestResultsStream(run, numberSchemas)
                            .pipe(Stream.runCollect),
                    ),
                }).toEqual({
                    baselines: [
                        {variant: 'A', baseline: Option.some(snapshots[0])},
                        {variant: 'B', baseline: Option.some(snapshots[4])},
                        {variant: 'C', baseline: Option.some(snapshots[2])},
                    ],
                    history: snapshots.toReversed(),
                    results: snapshots.map((_, index) => [result(index)]),
                });
            }).pipe(Effect.provide(TestRepository.layer(options)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
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
                    TestRun.make({
                        id: saved.id,
                        name: saved.name,
                        variant: saved.variant,
                        store: 'cache',
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
                state: Option.getOrThrow(yield* repository.getTestRun(saved))
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
    'a failed multi-variant commit rolls back snapshots and all baselines',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const {snapshot} = yield* TestRepositoryStorage;
            const sql = yield* snapshot;
            const previous = yield* Effect.forEach(['A', 'B'], variant =>
                repository.withTestRun(
                    {name: 'atomic-commit', variant},
                    () => Effect.void,
                ),
            );
            const saved = yield* repository.commitTestRuns(
                previous.map(({run}) => run),
            );
            const next = yield* Effect.forEach(['A', 'B'], (variant, index) =>
                repository.withTestRun({name: 'atomic-commit', variant}, run =>
                    repository.insertTestResult(
                        result(index),
                        run,
                        numberSchemas,
                    ),
                ),
            );
            yield* sql`CREATE TRIGGER reject_baseline BEFORE UPDATE ON ${sql(tables.testBaselines)}
        WHEN NEW.variant = 'B' BEGIN SELECT RAISE(ABORT, 'forced baseline failure'); END;`;
            const error = yield* repository
                .commitTestRuns(next.map(({run}) => run))
                .pipe(Effect.flip);
            expect({
                error: error._tag,
                baselines:
                    yield* repository.listVariantBaselines('atomic-commit'),
                history: (yield* repository.listTestRuns({
                    name: 'atomic-commit',
                    limit: 100,
                })).map(({isBaseline, ...run}) => run),
                rows: yield* sql`SELECT * FROM ${sql(tables.testResults)};`,
            }).toEqual({
                error: 'SqlError',
                baselines: [
                    {variant: 'A', baseline: Option.some(saved[0])},
                    {variant: 'B', baseline: Option.some(saved[1])},
                ],
                history: saved.toReversed(),
                rows: [],
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
                        .pipe(
                            Effect.flatMap(({run}) =>
                                repository.commitTestRuns([run]),
                            ),
                            Effect.map(saved => saved[0]),
                        ),
            );
            yield* repository.commitTestRuns([runs[0]]);
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
                baselines: [runs[103].id, runs[0].id],
                filtered: runs
                    .toReversed()
                    .filter(run => run.variant === 'B')
                    .map(({id}) => id),
                variants: [
                    {variant: 'A', baseline: Option.some(runs[0])},
                    {variant: 'B', baseline: Option.some(runs[103])},
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

it.effect(
    'routes equal numeric IDs to their own stores and preserves committed values',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const cachedA = yield* repository.withTestRun(
                {name: 'routing', variant: 'A'},
                run =>
                    repository.insertTestResult(result(1), run, numberSchemas),
            );
            const cachedB = yield* repository.withTestRun(
                {name: 'routing', variant: 'B'},
                run =>
                    repository.insertTestResult(result(2), run, numberSchemas),
            );
            const [snapshotB] = yield* repository.commitTestRuns([cachedB.run]);
            expect(snapshotB.id).toBe(cachedA.run.id);
            yield* repository.withTestRun(
                {name: 'routing', variant: 'B'},
                run =>
                    repository.insertTestResult(result(3), run, numberSchemas),
            );
            expect({
                cache: yield* repository.getTestRun(cachedA.run),
                snapshot: yield* repository.getTestRun(snapshotB),
                cacheRows: yield* repository
                    .getTestResultsStream(cachedA.run, numberSchemas)
                    .pipe(Stream.runCollect),
                snapshotRows: yield* repository
                    .getTestResultsStream(snapshotB, numberSchemas)
                    .pipe(Stream.runCollect),
            }).toEqual({
                cache: Option.some(cachedA.run),
                snapshot: Option.some(snapshotB),
                cacheRows: [result(1)],
                snapshotRows: [result(2)],
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('commit preserves encoded bytes and never invokes value codecs', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const cache = yield* SqlClient.SqlClient;
        const {snapshot} = yield* TestRepositoryStorage;
        const run = yield* repository.withTestRun(
            {name: 'encoded', variant: 'A'},
            run =>
                repository.insertTestResult(
                    result(1, {
                        tags: ['a,b', '', '日本語'],
                        ordering: 5,
                        resultOrdering: 2,
                        timeMillis: 4.5,
                    }),
                    run,
                    numberSchemas,
                ),
        );
        yield* cache`UPDATE ${cache(tables.testResults)} SET input = ' 1 ', result = '1.0', expected = '1e0';`;
        yield* cache`UPDATE ${cache(tables.testRunResults)} SET tags = '[ "a,b", "", "日本語" ]';`;
        const [saved] = yield* repository.commitTestRuns([run.run]);
        const sql = yield* snapshot;
        expect({
            repeated: yield* repository.commitTestRuns([run.run]),
            cache: yield* repository.getLatestTestRun(run.run),
            bytes: yield* sql`
                SELECT input, result, expected, tags, ordering, resultOrdering, timeMillis
                FROM ${sql(tables.testResults)} JOIN ${sql(tables.testRunResults)} ON id = testResult;
            `,
        }).toEqual({
            repeated: [saved],
            cache: Option.some(run.run),
            bytes: [
                {
                    input: ' 1 ',
                    result: '1.0',
                    expected: '1e0',
                    tags: '[ "a,b", "", "日本語" ]',
                    ordering: 5,
                    resultOrdering: 2,
                    timeMillis: 4.5,
                },
            ],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect('rejects duplicate selections without changing a baseline', () =>
    Effect.gen(function* () {
        const repository = yield* TestRepository;
        const {run} = yield* repository.withTestRun(
            {name: 'duplicate', variant: 'A'},
            () => Effect.void,
        );
        expect({
            error: (yield* repository
                .commitTestRuns([run, run])
                .pipe(Effect.flip))._tag,
            baseline: yield* repository.getBaselineTestRun(run),
            history: yield* repository.listTestRuns({
                name: run.name,
                limit: 10,
            }),
        }).toEqual({
            error: 'TestRunDuplicate',
            baseline: Option.none(),
            history: [],
        });
    }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'missing snapshots stay absent through reads and rejected commits',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: `${directory}/missing.sqlite`,
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: 'missing',
            };
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const complete = yield* repository.withTestRun(
                    {name: 'missing', variant: 'A'},
                    () => Effect.void,
                );
                yield* repository
                    .withTestRun({name: 'missing', variant: 'B'}, () =>
                        Effect.fail('failed'),
                    )
                    .pipe(Effect.exit);
                const failed = Option.getOrThrow(
                    yield* repository.getLatestTestRun({
                        name: 'missing',
                        variant: 'B',
                    }),
                );
                expect({
                    baseline: yield* repository.getBaselineTestRun(
                        complete.run,
                    ),
                    saved: yield* repository.getTestRun({
                        store: 'snapshot',
                        id: 1,
                    }),
                    history: yield* repository.listTestRuns({
                        name: 'missing',
                        limit: 10,
                    }),
                    variants: yield* repository.listVariantBaselines('missing'),
                    error: (yield* repository
                        .commitTestRuns([complete.run, failed])
                        .pipe(Effect.flip))._tag,
                    files: (yield* fs.readDirectory(directory)).filter(name =>
                        name.startsWith('missing'),
                    ),
                }).toEqual({
                    baseline: Option.none(),
                    saved: Option.none(),
                    history: [],
                    variants: [],
                    error: 'TestRunIncomplete',
                    files: [],
                });
            }).pipe(Effect.provide(TestRepository.layer(options)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'direct repository options reject the same file before changing it',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const filename = `${directory}/saved.sqlite`;
            const options = {
                dbPath: filename,
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: filename,
            };
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const {run} = yield* repository.withTestRun(
                    {name: 'protected', variant: 'A'},
                    () => Effect.void,
                );
                yield* repository.commitTestRuns([run]);
            }).pipe(Effect.provide(TestRepository.layer(options)));
            const before = yield* fs.readFile(filename);
            const error = yield* Effect.void.pipe(
                Effect.provide(
                    TestRepository.layer({...options, cachePath: filename}),
                ),
                Effect.flip,
            );
            expect({
                error: error._tag,
                bytes: yield* fs.readFile(filename),
            }).toEqual({
                error: 'RepositoryPathConflict',
                bytes: before,
            });
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'reads snapshots from a read-only file without changing any bytes',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: `${directory}/snapshot.sqlite`,
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: 'readonly',
            };
            const [snapshot] = yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const {run} = yield* repository.withTestRun(
                    {name: 'readonly', variant: 'A'},
                    run =>
                        repository.insertTestResult(
                            result(7),
                            run,
                            numberSchemas,
                        ),
                );
                return yield* repository.commitTestRuns([run]);
            }).pipe(Effect.provide(TestRepository.layer(options)));
            yield* fs.chmod(options.dbPath, 0o444);
            const before = yield* fs.readFile(options.dbPath);
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                expect({
                    baseline: yield* repository.getBaselineTestRun(snapshot),
                    rows: yield* repository
                        .getTestResultsStream(snapshot, numberSchemas)
                        .pipe(Stream.runCollect),
                }).toEqual({
                    baseline: Option.some(snapshot),
                    rows: [result(7)],
                });
                yield* repository.withTestRun(
                    {name: 'readonly', variant: 'A'},
                    () => Effect.void,
                );
                yield* repository.listTestRuns({name: 'readonly', limit: 10});
                yield* repository.listVariantBaselines('readonly');
            }).pipe(Effect.provide(TestRepository.layer(options)));
            expect({
                bytes: yield* fs.readFile(options.dbPath),
                sidecars: (yield* fs.readDirectory(directory)).filter(name =>
                    name.startsWith('snapshot.sqlite-'),
                ),
            }).toEqual({bytes: before, sidecars: []});
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'rejects an incompatible snapshot without changing it and recreates an old cache',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: `${directory}/old.sqlite`,
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: 'old',
            };
            for (const filename of [options.dbPath, options.cachePath]) {
                yield* Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    yield* sql`CREATE TABLE old_runs (id INTEGER PRIMARY KEY, name TEXT);`;
                    yield* sql`INSERT INTO old_runs VALUES (1, 'retained');`;
                }).pipe(
                    Effect.provide(
                        Sqlite.SqliteClient.layer({filename, disableWAL: true}),
                    ),
                );
            }
            const before = yield* fs.readFile(options.dbPath);
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const {run} = yield* repository.withTestRun(
                    {name: 'new', variant: 'A'},
                    () => Effect.void,
                );
                expect({
                    latest: yield* repository.getLatestTestRun(run),
                    readError: (yield* repository
                        .getBaselineTestRun(run)
                        .pipe(Effect.flip))._tag,
                    commitError: (yield* repository
                        .commitTestRuns([run])
                        .pipe(Effect.flip))._tag,
                }).toEqual({
                    latest: Option.some(run),
                    readError: 'RepositoryFormatError',
                    commitError: 'RepositoryFormatError',
                });
            }).pipe(Effect.provide(TestRepository.layer(options)));
            expect(yield* fs.readFile(options.dbPath)).toEqual(before);
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'shared cache files isolate snapshot identities and prune only their own attempts',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const cachePath = `${directory}/cache.sqlite`;
            const run = (snapshotIdentity: string, value: number) =>
                Effect.gen(function* () {
                    const repository = yield* TestRepository;
                    return (yield* repository.withTestRun(
                        {name: 'same', variant: 'A'},
                        run =>
                            repository.insertTestResult(
                                result(value),
                                run,
                                numberSchemas,
                            ),
                    )).run;
                }).pipe(
                    Effect.provide(
                        TestRepository.layer({
                            dbPath: ':memory:',
                            cachePath,
                            snapshotIdentity,
                        }),
                    ),
                );
            yield* run('first', 1);
            const other = yield* run('second', 2);
            const replacement = yield* run('first', 3);
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                expect({
                    own: yield* repository.getLatestTestRun(other),
                    foreign: yield* repository.getTestRun(replacement),
                    rows: yield* repository
                        .getTestResultsStream(other, numberSchemas)
                        .pipe(Stream.runCollect),
                }).toEqual({
                    own: Option.some(other),
                    foreign: Option.none(),
                    rows: [result(2)],
                });
            }).pipe(
                Effect.provide(
                    TestRepository.layer({
                        dbPath: ':memory:',
                        cachePath,
                        snapshotIdentity: 'second',
                    }),
                ),
            );
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'a file read keeps its selected rows when another repository replaces the cache',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: ':memory:',
                cachePath: `${directory}/cache.sqlite`,
                snapshotIdentity: 'stable',
            };
            yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const rows = Array.from({length: 205}, (_, index) =>
                    result(index),
                );
                const {run} = yield* repository.withTestRun(
                    {name: 'stable', variant: 'A'},
                    run =>
                        repository.insertTestResults(rows, run, numberSchemas),
                );
                let replaced = false;
                const read = yield* repository
                    .getTestResultsStream(run, numberSchemas)
                    .pipe(
                        Stream.mapEffect(row =>
                            Effect.gen(function* () {
                                if (!replaced) {
                                    replaced = true;
                                    yield* Effect.gen(function* () {
                                        const other = yield* TestRepository;
                                        yield* other.withTestRun(run, current =>
                                            other.insertTestResult(
                                                result(500),
                                                current,
                                                numberSchemas,
                                            ),
                                        );
                                    }).pipe(
                                        Effect.provide(
                                            TestRepository.layer(options),
                                        ),
                                    );
                                }
                                return row;
                            }),
                        ),
                        Stream.runCollect,
                    );
                expect({
                    read,
                    old: yield* repository.getTestRun(run),
                    commit: (yield* repository
                        .commitTestRuns([run])
                        .pipe(Effect.flip))._tag,
                    staleRead: (yield* repository
                        .getTestResultsStream(run, numberSchemas)
                        .pipe(Stream.runDrain, Effect.flip))._tag,
                }).toEqual({
                    read: rows,
                    old: Option.none(),
                    commit: 'TestRunNotFound',
                    staleRead: 'TestRunNotFound',
                });
            }).pipe(Effect.provide(TestRepository.layer(options)));
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
    'memory readers allow matching and statistics while delaying replacement',
    () =>
        Effect.gen(function* () {
            const repository = yield* TestRepository;
            const rows = Array.from({length: 105}, (_, index) => result(index));
            const {run} = yield* repository.withTestRun(
                {name: 'memory-read', variant: 'A'},
                run => repository.insertTestResults(rows, run, numberSchemas),
            );
            const firstRead = yield* Deferred.make<void>();
            const continueRead = yield* Deferred.make<void>();
            const reader = yield* Effect.forkChild(
                repository.withStats(collector =>
                    repository.getTestResultsStream(run, numberSchemas).pipe(
                        Stream.mapEffect(row =>
                            Effect.gen(function* () {
                                if (row.id === rows[0].id) {
                                    yield* Deferred.succeed(
                                        firstRead,
                                        undefined,
                                    );
                                    yield* Deferred.await(continueRead);
                                }
                                const matching = yield* repository
                                    .getTestResultsStream(run, numberSchemas, [
                                        row,
                                    ])
                                    .pipe(Stream.runCollect);
                                yield* collector.add(matching);
                                return row;
                            }),
                        ),
                        Stream.runCollect,
                        Effect.flatMap(read =>
                            collector.stats.pipe(
                                Effect.map(stats => ({
                                    read,
                                    total: stats.total,
                                })),
                            ),
                        ),
                    ),
                ),
            );
            yield* Deferred.await(firstRead);
            const writer = yield* Effect.forkChild(
                repository.withTestRun(
                    {name: run.name, variant: run.variant},
                    next =>
                        repository.insertTestResult(
                            result(500),
                            next,
                            numberSchemas,
                        ),
                ),
            );
            yield* Deferred.succeed(continueRead, undefined);
            expect(yield* Fiber.join(reader)).toEqual({
                read: rows,
                total: rows.length,
            });
            const replacement = yield* Fiber.join(writer);
            expect(yield* repository.getLatestTestRun(run)).toEqual(
                Option.some(replacement.run),
            );
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'a snapshot file created during commit is checked before changing journal mode',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const options = {
                dbPath: `${directory}/racing.sqlite`,
                cachePath: ':memory:',
                snapshotIdentity: 'racing',
            };
            let before: Uint8Array = new Uint8Array();
            const racingFs = {
                ...fs,
                exists: (filename: string) =>
                    filename === options.dbPath
                        ? Effect.gen(function* () {
                              yield* Effect.gen(function* () {
                                  const sql = yield* SqlClient.SqlClient;
                                  yield* sql`CREATE TABLE unrelated (value TEXT);`;
                                  yield* sql`INSERT INTO unrelated VALUES ('preserved');`;
                              }).pipe(
                                  Effect.provide(
                                      Sqlite.SqliteClient.layer({
                                          filename,
                                          disableWAL: true,
                                      }),
                                  ),
                              );
                              before = yield* fs.readFile(filename);
                              return false;
                          })
                        : fs.exists(filename),
            };
            const error = yield* Effect.gen(function* () {
                const repository = yield* TestRepository;
                const {run} = yield* repository.withTestRun(
                    {name: 'racing', variant: 'A'},
                    () => Effect.void,
                );
                return yield* repository.commitTestRuns([run]);
            }).pipe(
                Effect.provide(TestRepository.layer(options)),
                Effect.provideService(FileSystem.FileSystem, racingFs),
                Effect.flip,
            );
            expect({
                error: error._tag,
                bytes: yield* fs.readFile(options.dbPath),
            }).toEqual({
                error: 'RepositoryFormatError',
                bytes: before,
            });
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
