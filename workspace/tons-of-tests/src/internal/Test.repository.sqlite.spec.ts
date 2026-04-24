import * as SqlClient from '@effect/sql/SqlClient';
import * as t from '@effect/vitest';
import {Cause, Effect, Exit, Option, Stream} from 'effect';

import {
    RepositoryDecodeError,
    RepositoryWriteError,
} from '../RepositoryError.js';
import type * as Test from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {TestRun} from '../Test.repository.types.js';
import * as T from './Test.js';
import * as TR from './Test.repository.sqlite.js';

type TestCase = Test.TestCase<number, number>;
const add = (input: number) => Effect.succeed(input + 1);

// Each test uses a unique suite name and scopes queries to its own run via
// getTestResultsStream, so tests are robust to vitest reordering and the
// shared in-memory db contents from other tests in the same describe block.

t.describe('Test.repository.sqlite', () => {
    t.it('TestLayer is cached across accesses', () => {
        t.expect(TestRepository.TestLayer).toBe(TestRepository.TestLayer);
    });

    t.layer(TR.TestRepository.TestLayer, {excludeTestServices: true})('with shared in-memory db', it => {
        it.effect('getOrCreateCurrentTestRun creates, then re-creates after commit', () =>
            Effect.gen(function* () {
                const name = 'suite-get-or-create';
                const repository = yield* TR.TestRepository;

                const a = yield* repository.getOrCreateCurrentTestRun(name);
                t.expect(a.name).toBe(name);
                t.expect(a.hash).toBeNull();

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
                yield* repository.commitCurrentTestRun({name, hash: `${name}-1`});

                const b = yield* repository.getOrCreateCurrentTestRun(name);
                t.expect(b.name).toBe(name);
                t.expect(b.hash).toBeNull();
                // A fresh current-run row was created; the original was committed.
                t.expect(b.id).not.toBe(a.id);

                const runs = (yield* repository.getAllTestRuns).filter(
                    r => r.name === name,
                );
                const committed = runs.find(r => r.id === a.id);
                t.expect(committed?.hash).toBe(`${name}-1`);
            }),
        );

        it.effect('insertTestResult: round-trip + idempotent on re-insert', () =>
            Effect.gen(function* () {
                const name = 'suite-insert';
                const testCases: TestCase[] = [
                    {input: 111, expected: 112, tags: ['a', 'b']},
                    {input: 112, expected: 113, tags: []},
                    {input: 113, expected: 114},
                ];
                const repository = yield* TR.TestRepository;
                const testRun = yield* repository.getOrCreateCurrentTestRun(name);

                yield* T.all({testCases, program: add, name}).pipe(
                    Stream.tap(_ => repository.insertTestResult(_, testRun)),
                    Stream.runDrain,
                );

                const scopeToRun = Effect.gen(function* () {
                    const junction = yield* repository.getAllTestRunResults;
                    const all = yield* repository.getAllTestResults;
                    const idsForRun = new Set(
                        junction
                            .filter(j => j.testRun === testRun.id)
                            .map(j => j.testResult),
                    );
                    return all.filter(r => idsForRun.has(r.id));
                });

                const scoped = yield* scopeToRun;
                t.expect(scoped).toHaveLength(testCases.length);
                // tags survive the split(',') codec both ways
                const first = scoped.find(r => r.ordering === 0);
                t.expect(first?.tags).toEqual(['a', 'b']);
                const second = scoped.find(r => r.ordering === 1);
                t.expect(second?.tags).toEqual([]);

                const junctionBefore = (yield* repository.getAllTestRunResults).filter(
                    j => j.testRun === testRun.id,
                );

                // Re-inserting the same results is a no-op (ON CONFLICT DO NOTHING).
                yield* T.all({testCases, program: add, name}).pipe(
                    Stream.tap(_ => repository.insertTestResult(_, testRun)),
                    Stream.runDrain,
                );

                const junctionAfter = (yield* repository.getAllTestRunResults).filter(
                    j => j.testRun === testRun.id,
                );
                t.expect(junctionAfter).toHaveLength(junctionBefore.length);

                const scopedAgain = yield* scopeToRun;
                t.expect(scopedAgain).toHaveLength(testCases.length);

                const allResults = yield* repository.getAllTestResults;
                const scopedIds = new Set(scoped.map(r => r.id));
                const scopedAgainIds = new Set(scopedAgain.map(r => r.id));
                t.expect([...scopedAgainIds].sort()).toEqual([...scopedIds].sort());
                t.expect(allResults.filter(r => scopedIds.has(r.id))).toHaveLength(
                    testCases.length,
                );
            }),
        );

        it.effect('clearStale: keeps `keep` most recent commits, prunes orphans, leaves other suites alone', () =>
            Effect.gen(function* () {
                const other = 'clearStale-other';
                const target = 'clearStale-target';
                const repository = yield* TR.TestRepository;

                // Use inputs unique to this test so pruned results are truly
                // orphaned and get cleaned up.
                const otherInput = 799;
                const targetInputs = [751, 752, 753] as const;

                const otherRun = yield* repository.getOrCreateCurrentTestRun(other);
                yield* T.all({
                    testCases: [{input: otherInput, expected: otherInput + 1}],
                    program: add,
                    name: other,
                }).pipe(
                    Stream.tap(_ => repository.insertTestResult(_, otherRun)),
                    Stream.runDrain,
                );
                yield* repository.commitCurrentTestRun({name: other, hash: `${other}-1`});

                for (const input of targetInputs) {
                    const targetRun =
                        yield* repository.getOrCreateCurrentTestRun(target);
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

                const runs = yield* repository.getAllTestRuns;
                const targetHashes = new Set(
                    runs.filter(r => r.name === target).map(r => r.hash),
                );
                t.expect(targetHashes).toEqual(
                    new Set([null, `${target}-${targetInputs[2]}`]),
                );

                const otherHashes = new Set(
                    runs.filter(r => r.name === other).map(r => r.hash),
                );
                t.expect(otherHashes).toEqual(new Set([null, `${other}-1`]));

                // Verify orphan cleanup via the junction table. We check the
                // target suite's kept run only has 1 associated result, and
                // the pruned inputs (751, 752) are no longer referenced by
                // any surviving run.
                const allRunResults = yield* repository.getAllTestRunResults;
                const keptTargetRun = runs.find(
                    r => r.name === target && r.hash === `${target}-${targetInputs[2]}`,
                );
                t.expect(keptTargetRun).toBeDefined();
                const keptAssociations = allRunResults.filter(
                    rr => rr.testRun === keptTargetRun?.id,
                );
                t.expect(keptAssociations).toHaveLength(1);

                // Pruned target run IDs must not appear in the junction table.
                const survivingRunIds = new Set(runs.map(r => r.id));
                t.expect(allRunResults.every(rr => survivingRunIds.has(rr.testRun))).toBe(true);

                // Verify orphaned test-results rows (inputs 751, 752) were
                // pruned by the final DELETE in clearStale. Scope to results
                // referenced by the target/other suite runs — the shared
                // in-memory DB also holds rows from other tests.
                const allResults = yield* repository.getAllTestResults;
                const myRunIds = new Set(
                    runs
                        .filter(r => r.name === target || r.name === other)
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
                        .filter((x): x is number => typeof x === 'number'),
                );
                t.expect(allInputs.has(targetInputs[0])).toBe(false);
                t.expect(allInputs.has(targetInputs[1])).toBe(false);
            }),
        );

        it.effect('getOrCreateCurrentTestRun returns a decoded TestRun instance and is idempotent for the same name', () =>
            Effect.gen(function* () {
                const name = 'suite-get-or-create-idempotent';
                const repository = yield* TR.TestRepository;

                const a = yield* repository.getOrCreateCurrentTestRun(name);
                const b = yield* repository.getOrCreateCurrentTestRun(name);

                t.expect(a).toBeInstanceOf(TestRun);
                t.expect(b.id).toBe(a.id);
                t.expect(b.hash).toBeNull();

                const runs = (yield* repository.getAllTestRuns).filter(
                    r => r.name === name,
                );
                const current = runs.filter(r => r.hash === null);
                t.expect(current).toHaveLength(1);
            }),
        );

        it.effect('clearUncommitedTestResults is a no-op when no current run exists for the suite name', () =>
            Effect.gen(function* () {
                const repository = yield* TR.TestRepository;
                const exit = yield* Effect.exit(
                    repository.clearUncommitedTestResults({
                        name: 'suite-never-created',
                    }),
                );
                t.expect(Exit.isSuccess(exit)).toBe(true);
            }),
        );

        it.effect('clearStale is a no-op when there are fewer committed runs than `keep`', () =>
            Effect.gen(function* () {
                const name = 'suite-few-runs';
                const repository = yield* TR.TestRepository;
                const testRun = yield* repository.getOrCreateCurrentTestRun(name);
                yield* T.all({
                    testCases: [{input: 601, expected: 602}],
                    program: add,
                    name,
                }).pipe(
                    Stream.tap(_ => repository.insertTestResult(_, testRun)),
                    Stream.runDrain,
                );
                yield* repository.commitCurrentTestRun({name, hash: `${name}-1`});

                const before = (yield* repository.getAllTestRuns).filter(r => r.name === name);
                yield* repository.clearStale({name, keep: 3});
                const after = (yield* repository.getAllTestRuns).filter(r => r.name === name);
                t.expect(after.map(r => r.hash).sort()).toEqual(before.map(r => r.hash).sort());
            }),
        );
    });

    // Bogus-row test needs a separate db so the bad label does not break
    // other tests' getAllTestResults calls.
    t.layer(TR.TestRepository.TestLayer, {excludeTestServices: true})(
        'with isolated in-memory db (bogus row)',
        it => {
            it.effect('getAllTestResults surfaces RepositoryDecodeError on a bogus label row', () =>
                Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    const repository = yield* TR.TestRepository;

                    yield* sql`
                        INSERT INTO ${sql(TR.tables.testResults)}
                        ${sql.insert({
                            id: 'bogus',
                            hashTestCase: 'bogus',
                            ordering: 0,
                            input: 'null',
                            result: 'null',
                            expected: 'null',
                            label: 'NOT_A_LABEL',
                            tags: '',
                            timeMillis: 0,
                        })};
                    `;

                    const exit = yield* Effect.exit(repository.getAllTestResults);
                    t.expect(Exit.isFailure(exit)).toBe(true);
                    const err = Exit.isFailure(exit)
                        ? Cause.failureOption(exit.cause).pipe(Option.getOrThrow)
                        : null;
                    t.expect(err).toBeInstanceOf(RepositoryDecodeError);
                }),
            );
        },
    );

    t.layer(TR.TestRepository.TestLayer, {excludeTestServices: true})(
        'with isolated in-memory db (write failure)',
        it => {
            it.effect('insertTestResult surfaces RepositoryWriteError when the table is dropped', () =>
                Effect.gen(function* () {
                    const sql = yield* SqlClient.SqlClient;
                    const repository = yield* TR.TestRepository;
                    const name = 'suite-write-failure';

                    const testRun =
                        yield* repository.getOrCreateCurrentTestRun(name);

                    // Force subsequent writes to fail.
                    yield* sql`DROP TABLE ${sql(TR.tables.testResults)};`;

                    const sample: Test.TestResult<number, number, number> = {
                        id: 'x',
                        hashTestCase: 'x',
                        ordering: 0,
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
                        ? Cause.failureOption(exit.cause).pipe(Option.getOrThrow)
                        : null;
                    t.expect(err).toBeInstanceOf(RepositoryWriteError);
                }),
            );
        },
    );
});
