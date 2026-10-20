import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {Effect, FileSystem, Path, Schema, Stream} from 'effect';
import {ChildProcess, ChildProcessSpawner} from 'effect/process';

const Result = Schema.Struct({
    id: Schema.String,
    hashTestCase: Schema.String,
    key: Schema.String,
    ordering: Schema.Int,
    resultOrdering: Schema.Int,
    input: Schema.Finite,
    result: Schema.Finite,
    expected: Schema.Finite,
    label: Schema.String,
    tags: Schema.Array(Schema.String),
    timeMillis: Schema.Finite,
});
const RunResults = Schema.Struct({
    run: PT.TestRepository.TestRun,
    results: Schema.Array(Result),
});
const Response = Schema.fromJsonString(
    Schema.Struct({
        commands: Schema.Array(
            Schema.Struct({
                error: Schema.NullOr(Schema.String),
                count: Schema.NullOr(Schema.Int),
            }),
        ),
        cache: Schema.Array(Schema.NullOr(RunResults)),
        baselines: Schema.Array(Schema.NullOr(PT.TestRepository.TestRun)),
        snapshots: Schema.Array(
            Schema.Struct({
                ...RunResults.fields,
                isBaseline: Schema.Boolean,
            }),
        ),
        baseline: Schema.NullOr(PT.TestRepository.TestRun),
    }),
);
const runFixture = Effect.fn(function* (
    directory: string,
    commands: readonly (readonly string[])[],
    options: {
        dbPath?: string;
        cachePath?: string;
        mode?: 'normal' | 'forbid-execution' | 'fail-B' | 'report-failure';
        offset?: number;
        readBaseline?: boolean;
    } = {},
) {
    const path = yield* Path.Path;
    const projectDirectory = yield* path.fromFileUrl(
        new URL('../../../', import.meta.url),
    );
    const fixturePath = yield* path.fromFileUrl(
        new URL('./fixtures/cache-lifecycle.ts', import.meta.url),
    );
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
        ChildProcess.make(
            process.execPath,
            [
                '--import',
                'tsx',
                fixturePath,
                JSON.stringify({
                    directory,
                    commands,
                    dbPath: 'snapshots.sqlite',
                    mode: 'forbid-execution',
                    offset: 0,
                    readBaseline: false,
                    ...options,
                }),
            ],
            {cwd: projectDirectory},
        ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
        [
            child.stdout.pipe(
                Stream.decodeText(),
                Stream.runFold(
                    () => '',
                    (output, chunk) => output + chunk,
                ),
            ),
            child.stderr.pipe(
                Stream.decodeText(),
                Stream.runFold(
                    () => '',
                    (output, chunk) => output + chunk,
                ),
            ),
            child.exitCode,
        ],
        {concurrency: 3},
    );
    const marker = '\nCACHE_LIFECYCLE_RESULT=';
    const markerIndex = stdout.lastIndexOf(marker);
    expect(markerIndex, `${stdout}\n${stderr}`).toBeGreaterThanOrEqual(0);
    const state = yield* Schema.decodeEffect(Response)(
        stdout.slice(markerIndex + marker.length).trim(),
    );
    expect(exitCode, stderr).toBe(
        state.commands.some(command => command.error !== null) ? 1 : 0,
    );
    return {...state, output: stdout.slice(0, markerIndex)};
});

const snapshotFiles = Effect.fn(function* (directory: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.forEach(['', '-wal', '-shm', '-journal'], suffix =>
        fs.exists(path.join(directory, `snapshots.sqlite${suffix}`)),
    );
});

it.live(
    'reuses cached runs across processes and writes snapshots only on commit',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const first = yield* runFixture(directory, [['summarize']], {
                mode: 'normal',
            });
            expect(first.commands).toEqual([{error: null, count: null}]);
            expect(first.cache.map(entry => entry?.run.state)).toEqual([
                'Complete',
                'Complete',
            ]);
            expect(first.snapshots).toEqual([]);
            expect(yield* snapshotFiles(directory)).toEqual([
                false,
                false,
                false,
                false,
            ]);
            for (const command of [
                ['summarize', '--cached'],
                ['stats', '--cached'],
                ['diff', '--cached'],
                ['summarize', '--cached', '--tags', 'keep'],
                ['runs'],
            ]) {
                const reused = yield* runFixture(directory, [command], {
                    readBaseline: true,
                });
                expect(reused.commands).toEqual([{error: null, count: null}]);
                expect(reused.cache).toEqual(first.cache);
                expect(reused.baseline).toBeNull();
                expect(yield* snapshotFiles(directory)).toEqual([
                    false,
                    false,
                    false,
                    false,
                ]);
            }

            const committed = yield* runFixture(directory, [['commit']]);
            expect(committed.commands).toEqual([{error: null, count: null}]);
            expect(
                committed.snapshots.map(({run, results}) => ({
                    variant: run.variant,
                    store: run.store,
                    results: results.map(result => result.result),
                })),
            ).toEqual([
                {variant: 'B', store: 'snapshot', results: [101, 102, 103]},
                {variant: 'A', store: 'snapshot', results: [1, 2, 3]},
            ]);
            expect(committed.cache).toEqual(first.cache);
            const repeated = yield* runFixture(directory, [['commit']]);
            expect(repeated.commands).toEqual([{error: null, count: null}]);
            expect(repeated.snapshots).toEqual(committed.snapshots);
            expect(yield* snapshotFiles(directory)).toEqual([
                true,
                false,
                false,
                false,
            ]);
            const snapshotPath = path.join(directory, 'snapshots.sqlite');
            const savedBytes = yield* fs.readFile(snapshotPath);
            for (const command of [
                ['diff', '--cached', '--exit-on-diff'],
                ['summarize', '--cached'],
                ['stats', '--cached'],
                ['stats', '--runs', `A,run:${committed.baselines[1]?.id}`],
                [
                    'diff',
                    '--from',
                    `run:${committed.baselines[0]?.id}`,
                    '--to',
                    'B',
                ],
                ['runs'],
            ]) {
                const report = yield* runFixture(directory, [command], {
                    readBaseline: true,
                });
                expect(report.commands).toEqual([{error: null, count: null}]);
                expect(report.snapshots).toEqual(committed.snapshots);
                expect(report.baseline).toEqual(committed.baselines[0]);
                expect(yield* fs.readFile(snapshotPath)).toEqual(savedBytes);
                expect(yield* snapshotFiles(directory)).toEqual([
                    true,
                    false,
                    false,
                    false,
                ]);
            }
            for (const command of [
                ['stats', '--runs', 'missing'],
                ['diff', '--from', 'missing', '--to', 'A'],
            ]) {
                const failed = yield* runFixture(directory, [command]);
                expect(failed.commands[0]?.error).not.toBeNull();
                expect(failed.snapshots).toEqual(committed.snapshots);
                expect(yield* fs.readFile(snapshotPath)).toEqual(savedBytes);
            }
            const fresh = yield* runFixture(directory, [['diff']], {
                mode: 'normal',
                offset: 10,
            });
            expect(fresh.commands).toEqual([{error: null, count: null}]);
            expect(
                fresh.cache.map(entry =>
                    entry?.results.map(result => result.result),
                ),
            ).toEqual([
                [11, 12, 13],
                [111, 112, 113],
            ]);
            expect(fresh.snapshots).toEqual(committed.snapshots);
            expect(yield* fs.readFile(snapshotPath)).toEqual(savedBytes);
            expect(
                yield* fs.readFileString(
                    path.join(directory, 'executions.txt'),
                ),
            ).toBe(
                'A:1\nA:2\nA:3\nB:1\nB:2\nB:3\nA:1\nA:2\nA:3\nB:1\nB:2\nB:3\n',
            );

            const copyDirectory = yield* fs.makeTempDirectoryScoped();
            yield* fs.copyFile(
                snapshotPath,
                path.join(copyDirectory, 'snapshots.sqlite'),
            );
            const copied = yield* runFixture(copyDirectory, [
                ['stats', '--runs', 'A,B'],
            ]);
            expect(copied.commands).toEqual([{error: null, count: null}]);
            expect(copied.snapshots).toEqual(committed.snapshots);
            expect(copied.cache).toEqual([null, null]);
            expect(
                yield* fs.exists(path.join(copyDirectory, 'executions.txt')),
            ).toBe(false);
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000,
);

it.live(
    'keeps completed results reusable when reporting fails',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const failed = yield* runFixture(
                directory,
                [['summarize', '--variant', 'A']],
                {mode: 'report-failure'},
            );
            expect(failed.commands[0]?.error).toBe('PlatformError');
            expect(failed.cache[0]?.run.state).toBe('Complete');
            expect(yield* snapshotFiles(directory)).toEqual([
                false,
                false,
                false,
                false,
            ]);
            const reused = yield* runFixture(directory, [
                ['summarize', '--cached', '--variant', 'A'],
            ]);
            expect(reused.commands).toEqual([{error: null, count: null}]);
            expect(reused.cache).toEqual(failed.cache);
            const committed = yield* runFixture(directory, [
                ['commit', '--variant', 'A'],
            ]);
            expect(committed.commands).toEqual([{error: null, count: null}]);
            expect(
                committed.snapshots.map(snapshot => snapshot.results),
            ).toEqual([failed.cache[0]?.results]);
            expect(
                yield* fs.readFileString(
                    path.join(directory, 'executions.txt'),
                ),
            ).toBe('A:1\nA:2\nA:3\n');
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000,
);

it.live.each([false, true])(
    'does not reuse failed execution or partly commit variants; saved baselines: %s',
    saved =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            yield* runFixture(directory, [['summarize']], {mode: 'normal'});
            const before = yield* runFixture(
                directory,
                saved ? [['commit']] : [['runs']],
            );
            const snapshotPath = path.join(directory, 'snapshots.sqlite');
            const savedBytes = saved ? yield* fs.readFile(snapshotPath) : null;
            const failed = yield* runFixture(directory, [['summarize']], {
                mode: 'fail-B',
                offset: 10,
            });
            expect(failed.commands).toEqual([
                {error: 'FixtureExecutionFailure', count: null},
            ]);
            expect(failed.cache.map(entry => entry?.run.state)).toEqual([
                'Complete',
                'Failed',
            ]);
            const commit = yield* runFixture(directory, [['commit']]);
            expect(commit.commands[0]?.error).not.toBeNull();
            expect({
                baselines: commit.baselines,
                snapshots: commit.snapshots,
            }).toEqual({
                baselines: before.baselines,
                snapshots: before.snapshots,
            });
            const cached = yield* runFixture(directory, [
                ['summarize', '--cached', '--variant', 'B'],
            ]);
            expect(cached.commands).toEqual([
                {error: 'UnexpectedExecution', count: null},
            ]);
            if (savedBytes === null) {
                expect(yield* snapshotFiles(directory)).toEqual([
                    false,
                    false,
                    false,
                    false,
                ]);
            } else {
                expect(yield* fs.readFile(snapshotPath)).toEqual(savedBytes);
            }
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000,
);

it.live(
    'shares the default disk cache across processes with memory snapshots',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const first = yield* runFixture(directory, [['summarize']], {
                dbPath: ':memory:',
                mode: 'normal',
            });
            const committed = yield* runFixture(directory, [['commit']], {
                dbPath: ':memory:',
            });
            expect(committed.commands).toEqual([{error: null, count: null}]);
            expect(committed.snapshots).toHaveLength(2);
            const reused = yield* runFixture(
                directory,
                [['diff', '--cached', '--exit-on-diff']],
                {dbPath: ':memory:', readBaseline: true},
            );
            expect({
                commands: reused.commands,
                cache: reused.cache,
                baselines: reused.baselines,
                snapshots: reused.snapshots,
                baseline: reused.baseline,
            }).toEqual({
                commands: [{error: 'DiffNonEmpty', count: 6}],
                cache: first.cache,
                baselines: [null, null],
                snapshots: [],
                baseline: null,
            });
            expect(
                (yield* fs.readDirectory(
                    path.join(directory, '.cache', 'tons-of-tests'),
                )).filter(file => file.endsWith('.sqlite')),
            ).toHaveLength(1);
            expect(
                yield* fs.readFileString(
                    path.join(directory, 'executions.txt'),
                ),
            ).toBe('A:1\nA:2\nA:3\nB:1\nB:2\nB:3\n');
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000,
);

it.live(
    'retains a memory baseline while commands share one repository layer',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const result = yield* runFixture(
                directory,
                [
                    ['summarize'],
                    ['commit'],
                    ['diff', '--cached', '--exit-on-diff'],
                ],
                {dbPath: ':memory:', mode: 'normal'},
            );
            expect(result.commands).toEqual([
                {error: null, count: null},
                {error: null, count: null},
                {error: null, count: null},
            ]);
            expect(
                result.baselines.map(run => ({
                    store: run?.store,
                    variant: run?.variant,
                })),
            ).toEqual([
                {store: 'snapshot', variant: 'A'},
                {store: 'snapshot', variant: 'B'},
            ]);
            expect(
                yield* fs.readFileString(
                    path.join(directory, 'executions.txt'),
                ),
            ).toBe('A:1\nA:2\nA:3\nB:1\nB:2\nB:3\n');
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    60_000,
);
