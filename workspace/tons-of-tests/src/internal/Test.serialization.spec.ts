import {expect, it} from '@effect/vitest';
import {Effect, Exit, Schema, SchemaTransformation, Stream} from 'effect';

import * as Test from '../Test.js';
import {TestRepository} from '../Test.repository.js';
import {TestValueError} from '../TestValueError.js';
import * as Show from '../Show.js';
import {getAllTestResults} from './test-repository-fixtures.js';

it.effect(
    'keeps original case values and stores only the evaluated output',
    () =>
        Effect.gen(function* () {
            const Case = Schema.Struct({
                amount: Schema.BigInt,
                at: Schema.Date,
            });
            const input = {
                amount: 9_007_199_254_740_993n,
                at: new Date('2026-01-01T00:00:00Z'),
            };
            const expected = {...input};
            let programInput: typeof input | undefined;
            let evaluationExpected: typeof expected | undefined;
            const schemas = {
                testCase: {input: Case, expected: Case},
                evaluation: {result: Schema.BigInt, expected: Schema.BigInt},
            };
            const results = yield* Test.all({
                name: 'original-values',
                schemas,
                testCases: [{input, expected}],
                program: (value: typeof input) => {
                    programInput = value;
                    // The output need not be serializable: evaluate selects what to store.
                    return Effect.succeed({getAmount: () => value.amount});
                },
                evaluate: (output, target) => {
                    evaluationExpected = target;
                    return [
                        {
                            key: 'amount',
                            result: output.getAmount(),
                            expected: target.amount,
                            label: 'TP',
                        },
                    ];
                },
            }).pipe(Stream.runCollect);
            const repository = yield* TestRepository;
            const run =
                yield* repository.getOrCreateCurrentTestRun('original-values');
            yield* repository.withTestRun(
                run,
                repository.insertTestResults(results, run, schemas),
            );
            const saved = yield* repository
                .getTestResultsStream(run, schemas)
                .pipe(Stream.runCollect);
            expect(programInput).toBe(input);
            expect(evaluationExpected).toBe(expected);
            expect(results[0].input).toBe(input);
            expect(saved).toEqual(results);
            expect(saved[0].input.at).toBeInstanceOf(Date);
            expect(
                (yield* getAllTestResults).map(({input, result, expected}) => ({
                    input,
                    result,
                    expected,
                })),
            ).toEqual([
                {
                    input: {
                        amount: '9007199254740993',
                        at: '2026-01-01T00:00:00.000Z',
                    },
                    result: '9007199254740993',
                    expected: '9007199254740993',
                },
            ]);
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);

it.effect(
    'hashes encoded records independently of object key order and retains array order',
    () =>
        Effect.gen(function* () {
            const Value = Schema.Struct({
                values: Schema.Record(Schema.String, Schema.BigInt),
                sequence: Schema.Array(Schema.BigInt),
            });
            const first = {values: {a: 1n, b: 2n}, sequence: [1n, 2n]};
            const reordered = {sequence: [1n, 2n], values: {b: 2n, a: 1n}};
            const reversed = {...first, sequence: [2n, 1n]};
            const suite = {
                name: 'stable-json',
                schemas: {
                    testCase: {input: Value, expected: Value},
                    evaluation: {result: Value, expected: Value},
                },
                program: (input: typeof Value.Type) => Effect.succeed(input),
            };
            const results = yield* Test.all({
                ...suite,
                testCases: [
                    {input: first, expected: first},
                    {input: reordered, expected: reordered},
                    {input: reversed, expected: first},
                ],
            }).pipe(Stream.runCollect);
            const again = yield* Test.all({
                ...suite,
                testCases: [{input: reordered, expected: reordered}],
            }).pipe(Stream.runCollect);
            expect(
                results.map(({ordering, label}) => ({ordering, label})),
            ).toEqual([
                {ordering: 0, label: 'TP'},
                {ordering: 2, label: 'FP'},
            ]);
            expect([again[0].hashTestCase, again[0].id]).toEqual([
                results[0].hashTestCase,
                results[0].id,
            ]);
            expect(results[1].hashTestCase).not.toBe(results[0].hashTestCase);
        }),
);

it.effect.each([
    {name: 'null', Value: Schema.NullOr(Schema.BigInt), nil: null},
    {
        name: 'undefined',
        Value: Schema.UndefinedOr(Schema.BigInt),
        nil: undefined,
    },
])(
    'classifies bigint values and $name using their original values',
    ({Value, nil}) =>
        Effect.gen(function* () {
            const results = yield* Test.all({
                name: 'nil',
                schemas: {
                    testCase: {input: Value, expected: Value},
                    evaluation: {result: Value, expected: Value},
                },
                testCases: [
                    {input: 1n, expected: 1n},
                    {input: nil, expected: nil},
                    {input: 1n, expected: nil},
                    {input: nil, expected: 1n},
                    {input: 2n, expected: 1n},
                ],
                program: (value: bigint | null | undefined) =>
                    Effect.succeed(value),
            }).pipe(Stream.runCollect);
            expect(results.map(result => result.label)).toEqual([
                'TP',
                'TN',
                'FP',
                'FN',
                'FP',
            ]);
        }),
);

it.effect(
    'requires an explicit evaluator when result and expected use different schemas',
    () =>
        Effect.gen(function* () {
            let calls = 0;
            const exit = yield* Test.all({
                name: 'different-schemas',
                schemas: {
                    testCase: {input: Schema.Finite, expected: Schema.BigInt},
                    evaluation: {
                        result: Schema.BigIntFromString,
                        expected: Schema.BigInt,
                    },
                },
                testCases: [{input: 1, expected: 1n}],
                program: () =>
                    Effect.sync(() => {
                        calls++;
                        return 1n;
                    }),
            }).pipe(Stream.runDrain, Effect.exit);
            expect({failed: Exit.isFailure(exit), calls}).toEqual({
                failed: true,
                calls: 0,
            });
        }),
);

const invalidInputs: ReadonlyArray<{
    name: string;
    schema: Schema.Codec<unknown, unknown>;
    value: unknown;
    operation: TestValueError['operation'];
}> = [
    {
        name: 'bigint without a known encoding',
        schema: Schema.Unknown,
        value: 1n,
        operation: 'encode',
    },
    {
        name: 'an undeclared field',
        schema: Schema.Struct({amount: Schema.BigInt}),
        value: {amount: 1n, extra: true},
        operation: 'encode',
    },
    {
        name: 'an ambiguous union',
        schema: Schema.Union([Schema.BigInt, Schema.String]),
        value: '123',
        operation: 'roundTrip',
    },
    {
        name: 'a lossy custom transformation',
        schema: Schema.String.pipe(
            Schema.decode(
                SchemaTransformation.transform({
                    decode: value => value,
                    encode: value => value.toLowerCase(),
                }),
            ),
        ),
        value: 'KEEP THIS',
        operation: 'roundTrip',
    },
];

it.effect.each(invalidInputs)(
    'rejects $name before running the program',
    ({schema, value, operation}) =>
        Effect.gen(function* () {
            let calls = 0;
            const error = yield* Test.all({
                name: 'invalid-input',
                schemas: {
                    testCase: {input: schema, expected: Schema.Finite},
                    evaluation: {
                        result: Schema.Finite,
                        expected: Schema.Finite,
                    },
                },
                testCases: [{input: value, expected: 1}],
                program: () => Effect.sync(() => ++calls),
            }).pipe(Stream.runDrain, Effect.flip);
            expect({calls, error}).toMatchObject({
                calls: 0,
                error: {
                    _tag: 'TestValueError',
                    suite: 'invalid-input',
                    caseNumber: 1,
                    field: 'testCase.input',
                    operation,
                    cause: {_tag: 'SchemaError'},
                },
            });
        }),
);

it.effect.each(['result', 'expected'] as const)(
    'rejects an invalid evaluated %s without emitting part of a case',
    field =>
        Effect.gen(function* () {
            const Value = Schema.BigInt.check(
                Schema.makeFilter(value => value >= 0n),
            );
            const emitted: Test.TestResult[] = [];
            const error = yield* Test.all({
                name: 'invalid-evaluation-value',
                schemas: {
                    testCase: {input: Schema.Finite, expected: Value},
                    evaluation: {result: Value, expected: Value},
                },
                testCases: [{input: 1, expected: 1n}],
                program: () => Effect.succeed(1n),
                evaluate: (result, expected) => [
                    {key: 'first', result, expected, label: 'TP'},
                    {
                        key: 'second',
                        result: field === 'result' ? -1n : result,
                        expected: field === 'expected' ? -1n : expected,
                        label: 'FP',
                    },
                ],
            }).pipe(
                Stream.tap(result =>
                    Effect.sync(() => {
                        emitted.push(result);
                    }),
                ),
                Stream.runDrain,
                Effect.flip,
            );
            expect({emitted, error}).toMatchObject({
                emitted: [],
                error: {
                    _tag: 'TestValueError',
                    suite: 'invalid-evaluation-value',
                    caseNumber: 1,
                    key: 'second',
                    field: `evaluation.${field}`,
                    operation: 'encode',
                },
            });
        }),
);

it.effect(
    'saving and rendering reject lossy values through the same error channel',
    () =>
        Effect.gen(function* () {
            const Value = Schema.Union([Schema.BigInt, Schema.String]);
            const schemas = {
                testCase: {input: Schema.Finite},
                evaluation: {result: Value, expected: Value},
            };
            const repository = yield* TestRepository;
            const run =
                yield* repository.getOrCreateCurrentTestRun('lossy-result');
            const result: Test.TestResult<number, string, string> = {
                id: 'lossy',
                hashTestCase: 'case',
                key: 'amount',
                ordering: 0,
                resultOrdering: 0,
                label: 'TP',
                input: 1,
                result: '123',
                expected: '123',
                tags: [],
                timeMillis: 1,
            };
            const saveError = yield* repository
                .withTestRun(
                    run,
                    repository.insertTestResult(result, run, schemas),
                )
                .pipe(Effect.flip);
            const testRun = yield* Stream.make(result).pipe(
                Test.runCollectRecord(run),
            );
            const displayError = yield* Show.summarize({testRun, schemas}).pipe(
                Effect.flip,
            );
            const commitError = yield* repository
                .commitCurrentTestRun({name: run.name, hash: 'baseline'})
                .pipe(Effect.flip);
            expect({
                errors: [saveError, displayError].map(error =>
                    error._tag === 'TestValueError'
                        ? {
                              tag: error._tag,
                              field: error.field,
                              operation: error.operation,
                          }
                        : error._tag,
                ),
                complete: yield* repository.isComplete(run),
                saved: yield* repository.hasResults(run),
                commit: commitError._tag,
            }).toEqual({
                errors: Array.from({length: 2}, () => ({
                    tag: 'TestValueError',
                    field: 'evaluation.result',
                    operation: 'roundTrip',
                })),
                complete: false,
                saved: false,
                commit: 'TestRunIncomplete',
            });
        }).pipe(Effect.provide(TestRepository.TestLayer)),
);
