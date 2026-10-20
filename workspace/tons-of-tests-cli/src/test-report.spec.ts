import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {
    Effect,
    FileSystem,
    Layer,
    Option,
    Schema,
    SchemaTransformation,
    Stream,
} from 'effect';
import {SqlClient} from 'effect/sql';

import {prepareReport} from './test-run.js';
import type {ResultFilters} from './common.js';

const services = Layer.merge(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
);

it.effect.each([
    {mode: 'summarize' as const, filtered: false},
    {mode: 'summarize' as const, filtered: true},
    {mode: 'diff' as const, filtered: false},
    {mode: 'diff' as const, filtered: true},
])(
    '$mode renders the selected rows and computes exact statistics across batches (filtered=$filtered)',
    ({mode, filtered}) =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const config = {
                dbPath: ':memory:',
                displayConfig: {columnPadding: 3},
                testSuite: {
                    name: 'report',
                    testCases: [],
                    program: (input: number) => Effect.succeed(input),
                },
            };
            const makeResults = (changed: boolean): PT.Test.TestResult[] =>
                Array.from({length: 103}, (_, ordering) =>
                    ['budget', 'need', 'timeline'].map(
                        (key, resultOrdering): PT.Test.TestResult => {
                            const isChanged =
                                changed &&
                                ordering % 3 === 0 &&
                                key !== 'timeline';
                            return {
                                id: `${ordering}:${key}:${isChanged}`,
                                hashTestCase: `case-${ordering}`,
                                key,
                                ordering,
                                resultOrdering,
                                input: {
                                    id: ordering,
                                    note: 'first line\nsecond line 日本語',
                                },
                                result: isChanged ? ordering + 1 : ordering,
                                expected: ordering,
                                label: isChanged ? 'FP' : 'TP',
                                tags:
                                    ordering % 2 === 0
                                        ? ['included', 'a,b']
                                        : [],
                                timeMillis: ordering + (changed ? 1.5 : 0.5),
                            };
                        },
                    ),
                ).flat();
            const previous =
                yield* repository.getOrCreateCurrentTestRun('report');
            yield* repository.insertTestResults(makeResults(false), previous);
            yield* repository.commitCurrentTestRun({
                name: 'report',
                hash: 'baseline',
            });
            const current =
                yield* repository.getOrCreateCurrentTestRun('report');
            yield* repository.withTestRun(
                current,
                repository.insertTestResults(makeResults(true), current),
            );
            const filters: ResultFilters = filtered
                ? {
                      keys: Option.some(['budget', 'timeline']),
                      orTags: Option.some(['included']),
                  }
                : {};
            const visible = makeResults(true).filter(
                row =>
                    (!filtered ||
                        (row.ordering % 2 === 0 && row.key !== 'need')) &&
                    (mode === 'summarize' || row.label === 'FP'),
            );
            const visibleKeys = new Set(visible.map(PT.Test.resultKey));
            const expected = {
                testRun: yield* Stream.fromIterable(visible).pipe(
                    PT.Test.runCollectRecord(current),
                ),
                previousTestRun: Option.some(
                    yield* Stream.fromIterable(
                        makeResults(false).filter(row =>
                            visibleKeys.has(PT.Test.resultKey(row)),
                        ),
                    ).pipe(PT.Test.runCollectRecord(previous)),
                ),
            };
            const report = yield* prepareReport({
                mode,
                config,
                cached: true,
                ...filters,
            });
            const output = yield* report.chunks.pipe(
                Stream.runFold(
                    () => '',
                    (text, chunk) => text + chunk,
                ),
            );
            expect({
                output,
                count: report.count,
                stats: report.stats,
                previousStats:
                    mode === 'diff' ? report.previousStats : Option.none(),
            }).toEqual({
                output: PT.Show.summarize({
                    ...expected,
                    displayConfig: config.displayConfig,
                }),
                count: expected.testRun.testResultKeys.length,
                stats: expected.testRun.stats,
                previousStats:
                    mode === 'diff'
                        ? Option.map(expected.previousTestRun, run => run.stats)
                        : Option.none(),
            });
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
    'fresh output keeps its values without decoding them through cached-value schemas',
    () =>
        Effect.gen(function* () {
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'fresh-schema',
                    testCases: [{input: 42, expected: 42}],
                    program: (input: number) => Effect.succeed(input),
                    schemas: {
                        input: Schema.Finite,
                        result: Schema.Finite.pipe(
                            Schema.decodeTo(
                                Schema.Finite,
                                SchemaTransformation.transform({
                                    decode: value => value + 1,
                                    encode: value => value - 1,
                                }),
                            ),
                        ),
                        expected: Schema.Finite,
                    },
                },
            };
            const report = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            expect({count: report.count, passing: report.stats.TP}).toEqual({
                count: 1,
                passing: 1,
            });
            const output = yield* report.chunks.pipe(
                Stream.runFold(
                    () => '',
                    (text, chunk) => text + chunk,
                ),
            );
            const expected = yield* PT.Test.all(config.testSuite).pipe(
                PT.Test.runCollectRecord(
                    new PT.TestRepository.TestRun({
                        id: 0,
                        name: config.testSuite.name,
                        hash: null,
                    }),
                ),
            );
            expect(output).toBe(PT.Show.summarize({testRun: expected}));
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
    'duplicate cases have the same fresh and cached counts and call the program once per case',
    () =>
        Effect.gen(function* () {
            let calls = 0;
            const cases = Array.from({length: 120}, (_, input) => ({
                input,
                expected: input,
            }));
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'duplicate-report',
                    testCases: Stream.fromIterable([...cases, ...cases]),
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            const first = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            const cached = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: true,
            });
            expect({
                calls,
                counts: [first.count, cached.count],
                cases: [first.stats.testCases, cached.stats.testCases],
            }).toEqual({calls: 120, counts: [120, 120], cases: [120, 120]});
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect(
    'failed reports remove their temporary file and statistics tables',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const sql = yield* SqlClient.SqlClient;
            const files: string[] = [];
            const failure = {_tag: 'TestFailure'} as const;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'report-cleanup',
                    testCases: Array.from({length: 60}, (_, input) => ({
                        input,
                        expected: input,
                    })),
                    program: (input: number) =>
                        input === 55
                            ? Effect.fail(failure)
                            : Effect.succeed(input),
                },
            };
            const error = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            }).pipe(
                Effect.provideService(FileSystem.FileSystem, {
                    ...fs,
                    makeTempFileScoped: options =>
                        fs.makeTempFileScoped(options).pipe(
                            Effect.tap(path =>
                                Effect.sync(() => {
                                    files.push(path);
                                }),
                            ),
                        ),
                }),
                Effect.scoped,
                Effect.flip,
            );
            expect({
                error,
                createdFiles: files.length,
                filesStillPresent: yield* Effect.forEach(files, path =>
                    fs.exists(path),
                ),
                tables: yield* sql`SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name LIKE 'tots_stats_%';`,
            }).toEqual({
                error: failure,
                createdFiles: 1,
                filesStillPresent: [false],
                tables: [],
            });
        }).pipe(Effect.provide(services)),
);
