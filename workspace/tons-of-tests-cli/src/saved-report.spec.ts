import * as PT from '@creative-introvert/tons-of-tests';
import {NodeServices} from '@effect/platform-node';
import {expect, it} from '@effect/vitest';
import colors from 'ansi-colors';
import {
    Effect,
    FileSystem,
    Layer,
    Option,
    Schema,
    SchemaTransformation,
    Stream,
} from 'effect';

import {RunReference} from './common.js';
import {prepareSavedReport, resolveRun} from './test-run.js';

const services = Layer.merge(
    PT.TestRepository.TestRepository.TestLayer,
    NodeServices.layer,
);
const Score = Schema.Finite.pipe(
    Schema.decodeTo(
        Schema.Finite,
        SchemaTransformation.transform({
            decode: value => value + 1_000,
            encode: value => value - 1_000,
        }),
    ),
);
const Value = Schema.Struct({
    amount: Schema.BigInt,
    at: Schema.Date,
    score: Score,
});
const schemas = {
    testCase: {input: Value, expected: Value},
    evaluation: {result: Value, expected: Value},
};
const firstAmount = 9_007_199_254_740_993n;

it.effect(
    'compares rich saved runs across batches and suites without executing or changing baselines',
    () =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const makeResults = (
                side: 'from' | 'to',
            ): PT.Test.TestResult<
                typeof Value.Type,
                typeof Value.Type,
                typeof Value.Type
            >[] =>
                Array.from({length: 60}, (_, ordering) => {
                    const index = ordering + (side === 'to' ? 1 : 0);
                    const input = {
                        amount: firstAmount + BigInt(index),
                        at: new Date(Date.UTC(2026, 0, 1) + index * 86_400_000),
                        score: 1_000 + index,
                    };
                    return ['primary', 'detail'].map((key, resultOrdering) => {
                        const failed =
                            (side === 'to' &&
                                index < 60 &&
                                key === 'primary') ||
                            (side === 'from' && index === 0);
                        const label: PT.Classify.Label = failed ? 'FP' : 'TP';
                        return {
                            id: `${side}:${index}:${key}`,
                            hashTestCase: `case:${index}`,
                            key,
                            ordering,
                            resultOrdering,
                            input,
                            result: {
                                ...input,
                                amount: input.amount + (failed ? 1n : 0n),
                            },
                            expected: input,
                            label,
                            tags:
                                side === 'to' || index === 0
                                    ? ['visible']
                                    : ['old'],
                            timeMillis: index + (side === 'to' ? 101 : 1),
                        };
                    });
                }).flat();
            const {run: savedFrom} = yield* repository.withTestRun(
                {name: 'archive-suite', variant: 'A'},
                run =>
                    repository.insertTestResults(
                        makeResults('from'),
                        run,
                        schemas,
                    ),
            );
            const {run: savedTo} = yield* repository.withTestRun(
                {name: 'current-suite', variant: 'B'},
                run =>
                    repository.insertTestResults(
                        makeResults('to'),
                        run,
                        schemas,
                    ),
            );
            yield* repository.commitTestRun(savedFrom.id);
            yield* repository.commitTestRun(savedTo.id);
            let calls = 0;
            const config = {
                dbPath: ':memory:',
                testSuite: {
                    name: 'reader-suite',
                    schemas,
                    testCases: [],
                    program: (input: typeof Value.Type) =>
                        Effect.sync(() => {
                            calls++;
                            return input;
                        }),
                },
            };
            const from = yield* resolveRun(
                config.testSuite.name,
                yield* Schema.decodeEffect(RunReference)(`run:${savedFrom.id}`),
            );
            const to = yield* resolveRun(
                config.testSuite.name,
                yield* Schema.decodeEffect(RunReference)(`run:${savedTo.id}`),
            );
            const snapshot = Effect.gen(function* () {
                return {
                    runs: [
                        yield* repository.listTestRuns({
                            name: from.name,
                            limit: 100,
                        }),
                        yield* repository.listTestRuns({
                            name: to.name,
                            limit: 100,
                        }),
                    ],
                    baselines: [
                        yield* repository.getBaselineTestRun(from),
                        yield* repository.getBaselineTestRun(to),
                    ],
                    results: [
                        yield* repository
                            .getTestResultsStream(from, schemas)
                            .pipe(Stream.runCollect),
                        yield* repository
                            .getTestResultsStream(to, schemas)
                            .pipe(Stream.runCollect),
                    ],
                };
            });
            const before = yield* snapshot;
            const report = yield* prepareSavedReport({
                config,
                from,
                to,
                orTags: Option.some(['visible']),
            });
            const chunks = yield* report.chunks.pipe(Stream.runCollect);
            const output = chunks.join('');
            expect({
                count: report.count,
                current: report.stats,
                previous: Option.getOrThrow(report.previousStats),
            }).toEqual({
                count: 63,
                current: new PT.Classify.Stats({
                    TP: 2,
                    TN: 0,
                    FP: 59,
                    FN: 0,
                    total: 61,
                    testCases: 60,
                    precision: 2 / 61,
                    recall: 1,
                    timeMin: Option.some(102),
                    timeMax: Option.some(161),
                    timeMean: Option.some(131.5),
                    timeMedian: Option.some(131.5),
                }),
                previous: new PT.Classify.Stats({
                    TP: 59,
                    TN: 0,
                    FP: 2,
                    FN: 0,
                    total: 61,
                    testCases: 60,
                    precision: 59 / 61,
                    recall: 1,
                    timeMin: Option.some(1),
                    timeMax: Option.some(60),
                    timeMean: Option.some(30.5),
                    timeMedian: Option.some(30.5),
                }),
            });
            expect(
                chunks.flatMap(chunk =>
                    Array.from(
                        chunk.matchAll(/\b(changed|added|removed)\b/g),
                        match => match[1],
                    ),
                ),
            ).toEqual([
                ...Array.from({length: 59}, () => 'changed'),
                'added',
                'added',
                'removed',
                'removed',
            ]);
            expect(output).toContain(
                `from: archive-suite / A / run:${from.id}`,
            );
            expect(output).toContain(`to: current-suite / B / run:${to.id}`);
            expect(output).toContain('"9007199254741053"');
            expect(output).toContain('"2026-01-01T00:00:00.000Z"');
            expect(output).toContain('"2026-03-02T00:00:00.000Z"');
            expect(output).toContain('"score": 60');
            expect(output).not.toContain('"score": 1060');

            const decoded = {rows: 0, bigint: 0, dates: 0, scores: 0};
            const comparisons = PT.Test.compareRuns({from, to, schemas}).pipe(
                Stream.filter(row => {
                    const result = row._tag === 'OnlyFrom' ? row.from : row.to;
                    decoded.rows++;
                    if (typeof result.input.amount === 'bigint') {
                        decoded.bigint++;
                    }
                    if (result.input.at instanceof Date) decoded.dates++;
                    if (result.input.score >= 1_000) decoded.scores++;
                    return (
                        result.input.amount >= firstAmount &&
                        result.input.score >= 1_000 &&
                        (row._tag !== 'Matched' || row.changed)
                    );
                }),
            );
            const direct = yield* PT.Show.prepareComparison(comparisons, {
                from: Option.some(from),
                to,
                schemas,
            });
            expect({
                decoded,
                count: direct.count,
                output: (yield* direct.chunks.pipe(Stream.runCollect)).join(''),
                calls,
                saved: yield* snapshot,
            }).toEqual({
                decoded: {rows: 122, bigint: 122, dates: 122, scores: 122},
                count: 63,
                output,
                calls: 0,
                saved: before,
            });
        }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect('renders a saved added row whose input is null', () =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        const schemas = {
            testCase: {input: Schema.Null, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        };
        const result: PT.Test.TestResult<null, number, number> = {
            id: 'added-null',
            hashTestCase: 'null-case',
            key: 'null-input',
            ordering: 0,
            resultOrdering: 0,
            input: null,
            result: 1,
            expected: 1,
            label: 'TP',
            tags: [],
            timeMillis: 3,
        };
        const {run: from} = yield* repository.withTestRun(
            {name: 'empty-source', variant: 'A'},
            () => Effect.void,
        );
        const {run: to} = yield* repository.withTestRun(
            {name: 'null-target', variant: 'B'},
            run => repository.insertTestResult(result, run, schemas),
        );
        const report = yield* PT.Show.prepareComparison(
            PT.Test.compareRuns({from, to, schemas}),
            {from: Option.some(from), to, schemas},
        );
        const output = (yield* report.chunks.pipe(Stream.runCollect)).join('');
        expect(report.count).toBe(1);
        expect(output).toContain('added');
        expect(
            colors
                .unstyle(output)
                .split('\n')
                .filter(line => line.includes('null-input'))
                .map(line => line.split('│')[4].trim()),
        ).toEqual(['null']);
        expect(output).toContain(`from: empty-source / A / run:${from.id}`);
        expect(output).toContain(`to: null-target / B / run:${to.id}`);
    }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect.each(['from', 'to'] as const)(
    'attributes a rendering failure to the %s suite and removes its temporary file',
    side =>
        Effect.gen(function* () {
            const repository = yield* PT.TestRepository.TestRepository;
            const fs = yield* FileSystem.FileSystem;
            const files: string[] = [];
            const schemas = {
                testCase: {input: Schema.Finite},
                evaluation: {result: Schema.Finite, expected: Schema.Finite},
            };
            const makeResults = (
                current: 'from' | 'to',
            ): PT.Test.TestResult<number, number, number>[] =>
                [0, 1].map(ordering => ({
                    id: `${current}:${ordering}`,
                    hashTestCase: `case:${ordering}`,
                    key: 'number',
                    ordering,
                    resultOrdering: 0,
                    input: ordering,
                    result: current === side && ordering === 1 ? -1 : ordering,
                    expected: ordering,
                    label: 'TP',
                    tags: [],
                    timeMillis: 1,
                }));
            const {run: from} = yield* repository.withTestRun(
                {name: 'source-codec-suite', variant: 'A'},
                run =>
                    repository.insertTestResults(
                        makeResults('from'),
                        run,
                        schemas,
                    ),
            );
            const {run: to} = yield* repository.withTestRun(
                {name: 'target-codec-suite', variant: 'B'},
                run =>
                    repository.insertTestResults(
                        makeResults('to'),
                        run,
                        schemas,
                    ),
            );
            yield* repository.commitTestRun(from.id);
            yield* repository.commitTestRun(to.id);
            const NonNegative = Schema.Finite.check(
                Schema.makeFilter(value => value >= 0),
            );
            const error = yield* PT.Show.prepareComparison(
                PT.Test.compareRuns({from, to, schemas}),
                {
                    from: Option.some(from),
                    to,
                    schemas: {
                        ...schemas,
                        evaluation: {
                            ...schemas.evaluation,
                            result: NonNegative,
                        },
                    },
                },
            ).pipe(
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
            expect(error).toMatchObject({
                _tag: 'TestValueError',
                suite: side === 'from' ? from.name : to.name,
                caseNumber: 2,
                key: 'number',
                field: 'evaluation.result',
                operation: 'encode',
                cause: {_tag: 'SchemaError'},
            });
            expect({
                files: files.length,
                present: yield* Effect.forEach(files, path => fs.exists(path)),
                baselines: [
                    yield* repository.getBaselineTestRun(from),
                    yield* repository.getBaselineTestRun(to),
                ],
                results: [
                    yield* repository
                        .getTestResultsStream(from, schemas)
                        .pipe(Stream.runCollect),
                    yield* repository
                        .getTestResultsStream(to, schemas)
                        .pipe(Stream.runCollect),
                ],
            }).toEqual({
                files: 1,
                present: [false],
                baselines: [Option.some(from), Option.some(to)],
                results: [makeResults('from'), makeResults('to')],
            });
        }).pipe(Effect.provide(services)),
);
