import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import colors from 'ansi-colors';
import {
    Console,
    Effect,
    FileSystem,
    Layer,
    Option,
    PlatformError,
    Schema,
    SchemaTransformation,
    Sink,
    Stdio,
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
            yield* repository.commitTestRuns([first.run]);
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
                passing: first.stats.counts.TP,
                unchanged: unchanged.count,
                changed: [fresh.count, fresh.stats.counts.FP],
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
            const {run: previousAttempt} = yield* repository.withTestRun(
                {name: 'report', variant: 'default'},
                run =>
                    repository.insertTestResults(
                        makeResults(false),
                        run,
                        config.testSuite.schemas,
                    ),
            );
            const [previous] = yield* repository.commitTestRuns([
                previousAttempt,
            ]);
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
                expect(output).toContain('to: report / default / cache');
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
        expect({count: report.count, passing: report.stats.counts.TP}).toEqual({
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
            PT.Test.runCollectRecord({
                id: 0,
                name: config.testSuite.name,
                variant: 'default',
                state: 'Complete',
                store: 'cache',
            }),
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
            }).toEqual({
                error: failure,
                createdFiles: 1,
                filesStillPresent: [false],
                tables: [],
                state: 'Complete',
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each([
    {
        labels: 'TP,failure-timeout',
        visible: ['row-1', 'row-2'],
        absent: ['row-3'],
        counts: {TP: '1', 'failure-timeout': '1'},
        total: '2',
    },
    {
        labels: 'failure-timeout',
        visible: ['row-2'],
        absent: ['row-1', 'row-3'],
        counts: {TP: '0', 'failure-timeout': '1'},
        total: '1',
    },
    {
        labels: 'not-recorded',
        visible: [],
        absent: ['row-1', 'row-2', 'row-3'],
        counts: {TP: '0'},
        total: '0',
    },
])(
    'CLI filters $labels and recalculates statistics while keeping the whole cache',
    scenario =>
        Effect.gen(function* () {
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                displayConfig: {colorize: false},
                testSuite: {
                    name: 'custom-filter',
                    schemas: numberSchemas,
                    testCases: [1, 2, 3].map(input => ({
                        input,
                        expected: input,
                    })),
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                    evaluate: (result: number, expected: number) =>
                        [
                            {
                                key: `row-${result}`,
                                result,
                                expected,
                                label:
                                    result === 1
                                        ? 'TP'
                                        : result === 2
                                          ? 'failure-timeout'
                                          : 'inconclusive',
                            },
                        ] as const,
                },
            };
            const output: string[] = [];
            const console = yield* Console.Console;
            yield* effectNoDeps(config, [
                'node',
                'suite',
                'summarize',
                '--labels',
                scenario.labels,
            ]).pipe(
                Effect.provideService(
                    Console.Console,
                    new Proxy(console, {
                        get: (target, key, receiver) =>
                            key === 'log'
                                ? (...args: readonly unknown[]) => {
                                      output.push(args.map(String).join(' '));
                                  }
                                : Reflect.get(target, key, receiver),
                    }),
                ),
                Effect.provide(
                    Stdio.layerTest({
                        stdout: () =>
                            Sink.forEach(chunk =>
                                Effect.sync(() => {
                                    output.push(String(chunk));
                                }),
                            ),
                    }),
                ),
            );
            const text = output.join('\n');
            expect(text).toBe(colors.unstyle(text));
            for (const key of scenario.visible) expect(text).toContain(key);
            for (const key of scenario.absent) expect(text).not.toContain(key);
            const statsRows = text
                .split('STATS')[1]
                .split('\n')
                .filter(line => line.startsWith('│'))
                .map(line =>
                    line
                        .split('│')
                        .slice(1, -1)
                        .map(cell => cell.trim()),
                );
            expect(
                Object.fromEntries(
                    statsRows[0].map((header, index) => [
                        header,
                        statsRows[1][index],
                    ]),
                ),
            ).toMatchObject({
                cases: scenario.total,
                results: scenario.total,
                ...scenario.counts,
            });
            const repository = yield* PT.TestRepository.TestRepository;
            const saved = Option.getOrThrow(
                yield* repository.getLatestTestRun({
                    name: config.testSuite.name,
                    variant: 'default',
                }),
            );
            expect({
                calls,
                labels: (yield* repository
                    .getTestResultsStream(saved, numberSchemas)
                    .pipe(Stream.runCollect)).map(row => row.label),
            }).toEqual({
                calls: 3,
                labels: ['TP', 'failure-timeout', 'inconclusive'],
            });
        }).pipe(Effect.provide(services)),
);

it.effect.each(['', ' TP', 'TP,', 'failure\ntimeout'])(
    'CLI rejects malformed label filter %j before running tests',
    labels =>
        Effect.gen(function* () {
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'invalid-label-filter',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            const error = yield* effectNoDeps(config, [
                'node',
                'suite',
                'summarize',
                '--labels',
                labels,
            ]).pipe(Effect.flip);
            expect({tag: error._tag, calls}).toEqual({
                tag: 'ShowHelp',
                calls: 0,
            });
        }).pipe(Effect.provide(services)),
);

it.effect(
    'fresh and cached summaries style current and previous custom labels using the current settings',
    () =>
        Effect.gen(function* () {
            let calls = 0;
            let label = 'failure-timeout';
            const config = {
                dbPath: ':memory:',
                displayConfig: {
                    labels: {
                        'failure-timeout': {
                            color: 'magenta',
                            valence: 'negative',
                        },
                        recovered: {color: 'cyan', valence: 'positive'},
                    },
                } satisfies Partial<PT.DisplayConfig.DisplayConfig>,
                testSuite: {
                    name: 'custom-style',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (input: number) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                    evaluate: (result: number, expected: number) =>
                        [{key: 'answer', result, expected, label}] as const,
                },
            };
            const first = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            expect(
                (yield* first.chunks.pipe(Stream.runCollect)).join(''),
            ).toContain(colors.magenta('failure-timeout'));
            const repository = yield* PT.TestRepository.TestRepository;
            yield* repository.commitTestRuns([first.run]);
            label = 'recovered';
            const fresh = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: false,
            });
            const cached = yield* prepareReport({
                mode: 'summarize',
                config,
                cached: true,
            });
            const output = (yield* fresh.chunks.pipe(Stream.runCollect)).join(
                '',
            );
            expect(output).toContain(colors.cyan('recovered'));
            expect(output).toContain(colors.magenta('failure-timeout'));
            expect({
                calls,
                counts: fresh.stats.counts,
                cached: (yield* cached.chunks.pipe(Stream.runCollect)).join(''),
            }).toEqual({
                calls: 2,
                counts: {TP: 0, TN: 0, FP: 0, FN: 0, recovered: 1},
                cached: output,
            });
            const neutral = yield* prepareReport({
                mode: 'summarize',
                config: {...config, displayConfig: {labels: {}}},
                cached: true,
            });
            const neutralOutput = (yield* neutral.chunks.pipe(
                Stream.runCollect,
            )).join('');
            expect(neutralOutput).toContain(' failure-timeout ');
            expect(neutralOutput).toContain(' recovered ');
            const plain = yield* prepareReport({
                mode: 'summarize',
                config: {
                    ...config,
                    displayConfig: {...config.displayConfig, colorize: false},
                },
                cached: true,
            });
            const plainOutput = (yield* plain.chunks.pipe(
                Stream.runCollect,
            )).join('');
            expect(plainOutput).toBe(colors.unstyle(output));
            const run = yield* repository
                .getTestResultsStream(cached.run, numberSchemas)
                .pipe(PT.Test.runCollectRecord(cached.run));
            const previousRun = Option.getOrThrow(
                yield* repository.getBaselineTestRun(cached.run),
            );
            const previous = yield* repository
                .getTestResultsStream(previousRun, numberSchemas)
                .pipe(PT.Test.runCollectRecord(previousRun));
            expect(
                yield* PT.Show.summarize({
                    testRun: run,
                    previousTestRun: Option.some(previous),
                    schemas: numberSchemas,
                    displayConfig: config.displayConfig,
                }),
            ).toBe(output);
        }).pipe(Effect.scoped, Effect.provide(services)),
);
