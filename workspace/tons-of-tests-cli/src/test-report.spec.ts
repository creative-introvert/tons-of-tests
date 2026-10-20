import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import {
    Console,
    Effect,
    FileSystem,
    Layer,
    Option,
    PlatformError,
    Schema,
    SchemaTransformation,
    Stream,
} from 'effect';
import {SqlClient} from 'effect/sql';

import {prepareReport} from './test-run.js';
import {effectNoDeps} from './index.js';
import type {ResultFilters} from './common.js';

const numberSchemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};
const ReportInput = Schema.Struct({id: Schema.Int, note: Schema.String});

const services = Layer.merge(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
);

it.effect(
    'fresh and cached reports compare and display bigint and Date values',
    () =>
        Effect.gen(function* () {
            const Value = Schema.Struct({
                amount: Schema.BigIntFromString,
                at: Schema.Date,
                measurements: Schema.Record(Schema.String, Schema.BigInt),
            });
            const input = {
                amount: 9_007_199_254_740_993n,
                at: new Date('2026-01-01T00:00:00Z'),
                measurements: {z: 2n, a: 1n},
            };
            let offset = 0n;
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'rich-report',
                    schemas: {
                        testCase: {input: Value, expected: Value},
                        evaluation: {result: Value, expected: Value},
                    },
                    testCases: [{input, expected: input}],
                    program: (value: typeof Value.Type) =>
                        Effect.sync(() => {
                            calls++;
                            return {
                                ...value,
                                amount: value.amount + offset,
                                at: new Date(value.at.getTime()),
                            };
                        }),
                },
            };
            const first = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            const repository = yield* PT.TestRepository.TestRepository;
            yield* repository.commitTestRun(first.run.id);
            const unchanged = yield* prepareReport({
                mode: 'diff',
                config,
                cached: false,
            });
            offset = 1n;
            const fresh = yield* prepareReport({
                mode: 'diff',
                config,
                cached: false,
            });
            const cached = yield* prepareReport({
                mode: 'diff',
                config,
                cached: true,
            });
            expect({
                calls,
                passing: first.stats.TP,
                unchanged: unchanged.count,
                changed: [fresh.count, fresh.stats.FP],
                cachedStats: cached.stats,
                cachedOutput: yield* cached.chunks.pipe(Stream.runCollect),
            }).toEqual({
                calls: 3,
                passing: 1,
                unchanged: 0,
                changed: [1, 1],
                cachedStats: fresh.stats,
                cachedOutput: yield* fresh.chunks.pipe(Stream.runCollect),
            });
            const run = cached.run;
            const testRun = yield* repository
                .getTestResultsStream(run, config.testSuite.schemas)
                .pipe(PT.Test.runCollectRecord(run));
            const result = testRun.testResultsByKey[testRun.testResultKeys[0]];
            expect({
                input: result.input,
                result: result.result,
                expected: result.expected,
            }).toEqual({
                input,
                result: {...input, amount: input.amount + 1n},
                expected: input,
            });
            const table = yield* PT.Show.summarize({
                testRun,
                schemas: config.testSuite.schemas,
                selectColumns: ['input', 'result', 'expected'],
            });
            expect(table).toContain('"9007199254740994"');
            expect(table).toContain('2026-01-01T00:00:00.000Z');
        }).pipe(Effect.scoped, Effect.provide(services)),
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
                    schemas: {
                        testCase: {input: ReportInput, expected: Schema.Finite},
                        evaluation: numberSchemas.evaluation,
                    },
                    testCases: [],
                    program: (input: typeof ReportInput.Type) =>
                        Effect.succeed(input.id),
                },
            };
            const makeResults = (
                changed: boolean,
            ): PT.Test.TestResult<typeof ReportInput.Type, number, number>[] =>
                Array.from({length: 103}, (_, ordering) =>
                    ['budget', 'need', 'timeline'].map(
                        (
                            key,
                            resultOrdering,
                        ): PT.Test.TestResult<
                            typeof ReportInput.Type,
                            number,
                            number
                        > => {
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
            const {run: previous} = yield* repository.withTestRun(
                {name: 'report', variant: 'default'},
                run =>
                    repository.insertTestResults(
                        makeResults(false),
                        run,
                        config.testSuite.schemas,
                    ),
            );
            yield* repository.commitTestRun(previous.id);
            const {run: current} = yield* repository.withTestRun(
                {name: 'report', variant: 'default'},
                run =>
                    repository.insertTestResults(
                        makeResults(true),
                        run,
                        config.testSuite.schemas,
                    ),
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
                count: report.count,
                stats: report.stats,
                previousStats:
                    mode === 'diff' ? report.previousStats : Option.none(),
            }).toEqual({
                count: expected.testRun.testResultKeys.length,
                stats: expected.testRun.stats,
                previousStats:
                    mode === 'diff'
                        ? Option.map(expected.previousTestRun, run => run.stats)
                        : Option.none(),
            });
            expect(output).toContain('first line');
            expect(output).toContain('日本語');
            if (mode === 'diff') {
                expect(output).toContain(`run:${previous.id}`);
                expect(output).toContain(`run:${current.id}`);
            }
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('fresh and cached reports use both directions of custom codecs', () =>
    Effect.gen(function* () {
        const Value = Schema.Finite.pipe(
            Schema.decodeTo(
                Schema.Finite,
                SchemaTransformation.transform({
                    decode: value => value + 1,
                    encode: value => value - 1,
                }),
            ),
        );
        const config = {
            dbPath: ':memory:',
            testSuite: {
                name: 'fresh-schema',
                testCases: [{input: 42, expected: 42}],
                program: (input: number) => Effect.succeed(input),
                schemas: {
                    testCase: {input: Schema.Finite, expected: Value},
                    evaluation: {result: Value, expected: Value},
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
                    variant: 'default',
                    state: 'Complete',
                }),
            ),
        );
        expect(output).toBe(
            yield* PT.Show.summarize({
                testRun: expected,
                schemas: config.testSuite.schemas,
            }),
        );
        const cached = yield* prepareReport({
            mode: 'summarize',
            config,
            cached: true,
        });
        expect((yield* cached.chunks.pipe(Stream.runCollect)).join('')).toBe(
            output,
        );
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
                    schemas: numberSchemas,
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
            const console = yield* Console.Console;
            const output: string[] = [];
            const capturedConsole: Console.Console = Object.assign(
                Object.create(console),
                {
                    log: (...args: ReadonlyArray<unknown>) => {
                        output.push(args.map(String).join(' '));
                    },
                },
            );
            const failure = PlatformError.systemError({
                _tag: 'Unknown',
                module: 'FileSystem',
                method: 'makeTempFileScoped',
            });
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'report-cleanup',
                    schemas: numberSchemas,
                    testCases: Array.from({length: 60}, (_, input) => ({
                        input,
                        expected: input,
                    })),
                    program: (input: number) => Effect.succeed(input),
                },
            };
            const error = yield* effectNoDeps(config, [
                'node',
                'suite',
                'summarize',
            ]).pipe(
                Effect.provideService(Console.Console, capturedConsole),
                Effect.provideService(FileSystem.FileSystem, {
                    ...fs,
                    makeTempFileScoped: options =>
                        fs.makeTempFileScoped(options).pipe(
                            Effect.tap(path =>
                                Effect.sync(() => {
                                    files.push(path);
                                }),
                            ),
                            Effect.andThen(Effect.fail(failure)),
                        ),
                }),
                Effect.scoped,
                Effect.flip,
            );
            const saved = Option.getOrThrow(
                yield* (yield* PT.TestRepository
                    .TestRepository).getLatestTestRun({
                    name: 'report-cleanup',
                    variant: 'default',
                }),
            );
            expect({
                error,
                createdFiles: files.length,
                filesStillPresent: yield* Effect.forEach(files, path =>
                    fs.exists(path),
                ),
                tables: yield* sql`SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name LIKE 'tots_stats_%';`,
                state: saved.state,
                output,
            }).toEqual({
                error: failure,
                createdFiles: 1,
                filesStillPresent: [false],
                tables: [],
                state: 'Complete',
                output: [`Created report-cleanup / default / run:${saved.id}.`],
            });
        }).pipe(Effect.provide(services)),
);
