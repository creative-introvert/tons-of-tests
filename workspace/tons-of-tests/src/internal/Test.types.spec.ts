import * as t from '@effect/vitest';
import {Context, Effect, Schema, Stream} from 'effect';

import * as Test from '../Test.js';
import type {TestValueError} from '../TestValueError.js';

class First extends Context.Service<First, {value: number}>()('First') {}
class Second extends Context.Service<Second, {value: number}>()('Second') {}
class Cases extends Context.Service<Cases, {value: number}>()('Cases') {}

const schemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};

type LibraryError =
    | TestValueError
    | Test.TestVariantRequired
    | Test.TestVariantNotFound;
type FirstError = {readonly _tag: 'FirstError'};
type SecondError = {readonly _tag: 'SecondError'};
type CasesError = {readonly _tag: 'CasesError'};

const cases = Stream.fromEffect(
    Effect.gen(function* () {
        const {value} = yield* Cases;
        if (value < 0) return yield* Effect.fail({_tag: 'CasesError'} as const);
        return {input: value, expected: value};
    }),
);

t.it(
    'infers every program and case-stream channel in default evaluation',
    () => {
        const results = Test.all(
            {
                name: 'inferred-default',
                schemas,
                testCases: cases,
                variants: {
                    A: {
                        program: (input: number) =>
                            Effect.gen(function* () {
                                const {value} = yield* First;
                                if (value < 0)
                                    return yield* Effect.fail({
                                        _tag: 'FirstError',
                                    } as const);
                                return input + value;
                            }),
                    },
                    B: {
                        program: (input: number) =>
                            Effect.gen(function* () {
                                const {value} = yield* Second;
                                if (value < 0)
                                    return yield* Effect.fail({
                                        _tag: 'SecondError',
                                    } as const);
                                return input + value;
                            }),
                    },
                },
            },
            {variant: 'A'},
        );
        t.expectTypeOf<Stream.Success<typeof results>>().toEqualTypeOf<
            Test.TestResult<number, number, number>
        >();
        t.expectTypeOf<Stream.Error<typeof results>>().toEqualTypeOf<
            LibraryError | FirstError | SecondError | CasesError
        >();
        t.expectTypeOf<Stream.Services<typeof results>>().toEqualTypeOf<
            First | Second | Cases
        >();
    },
);

t.it(
    'infers every program and case-stream channel in custom evaluation',
    () => {
        const results = Test.all(
            {
                name: 'inferred-custom',
                schemas: {
                    ...schemas,
                    evaluation: {
                        result: Schema.String,
                        expected: Schema.Finite,
                    },
                },
                testCases: cases,
                variants: {
                    A: {
                        program: (input: number) =>
                            Effect.gen(function* () {
                                const {value} = yield* First;
                                if (value < 0)
                                    return yield* Effect.fail({
                                        _tag: 'FirstError',
                                    } as const);
                                return {value: input + value};
                            }),
                    },
                    B: {
                        program: (input: number) =>
                            Effect.gen(function* () {
                                const {value} = yield* Second;
                                if (value < 0)
                                    return yield* Effect.fail({
                                        _tag: 'SecondError',
                                    } as const);
                                return {value: input + value};
                            }),
                    },
                },
                evaluate: (output, expected) => [
                    {
                        key: 'value',
                        result: String(output.value),
                        expected,
                        label: 'TP',
                    },
                ],
            },
            {variant: 'B'},
        );
        t.expectTypeOf<Stream.Success<typeof results>>().toEqualTypeOf<
            Test.TestResult<number, string, number>
        >();
        t.expectTypeOf<Stream.Error<typeof results>>().toEqualTypeOf<
            LibraryError | FirstError | SecondError | CasesError
        >();
        t.expectTypeOf<Stream.Services<typeof results>>().toEqualTypeOf<
            First | Second | Cases
        >();
    },
);

t.it('infers single programs and empty variant maps', () => {
    const single = Test.all({
        name: 'single',
        schemas,
        testCases: cases,
        program: (input: number) =>
            Effect.gen(function* () {
                const {value} = yield* First;
                if (value < 0)
                    return yield* Effect.fail({_tag: 'FirstError'} as const);
                return input + value;
            }),
    });
    t.expectTypeOf<Stream.Error<typeof single>>().toEqualTypeOf<
        LibraryError | FirstError | CasesError
    >();
    t.expectTypeOf<Stream.Services<typeof single>>().toEqualTypeOf<
        First | Cases
    >();
    const empty = Test.all({
        name: 'empty',
        schemas,
        testCases: cases,
        variants: {},
    });
    t.expectTypeOf<Stream.Error<typeof empty>>().toEqualTypeOf<
        LibraryError | CasesError
    >();
    t.expectTypeOf<Stream.Services<typeof empty>>().toEqualTypeOf<Cases>();
    const singleCustom = Test.all({
        name: 'single-custom',
        schemas,
        testCases: cases,
        program: (input: number) =>
            Effect.gen(function* () {
                const {value} = yield* First;
                if (value < 0)
                    return yield* Effect.fail({_tag: 'FirstError'} as const);
                return {value: input + value};
            }),
        evaluate: (output, expected) => [
            {key: 'value', result: output.value, expected, label: 'TP'},
        ],
    });
    t.expectTypeOf<Stream.Error<typeof singleCustom>>().toEqualTypeOf<
        LibraryError | FirstError | CasesError
    >();
    t.expectTypeOf<Stream.Services<typeof singleCustom>>().toEqualTypeOf<
        First | Cases
    >();
    const emptyCustom = Test.all({
        name: 'empty-custom',
        schemas,
        testCases: cases,
        variants: {},
        evaluate: (output: number, expected) => [
            {key: 'value', result: output, expected, label: 'TP'},
        ],
    });
    t.expectTypeOf<Stream.Error<typeof emptyCustom>>().toEqualTypeOf<
        LibraryError | CasesError
    >();
    t.expectTypeOf<
        Stream.Services<typeof emptyCustom>
    >().toEqualTypeOf<Cases>();
});

t.it('selects without requiring any program services', () => {
    const selected = Test.selectVariant(
        {
            name: 'selected',
            variants: {
                A: {program: (input: number) => Effect.as(First, input)},
                B: {program: (input: number) => Effect.as(Second, input)},
            },
        },
        'A',
    );
    t.expectTypeOf<Effect.Services<typeof selected>>().toEqualTypeOf<never>();
    t.expectTypeOf<
        Effect.Services<ReturnType<Effect.Success<typeof selected>['program']>>
    >().toEqualTypeOf<First | Second>();
});

t.it('rejects incompatible programs and invalid definition forms', () => {
    const common = {
        name: 'invalid',
        schemas,
        testCases: [{input: 1, expected: 1}],
    };
    // @ts-expect-error Without evaluate, the program's output must fit the result codec.
    void Test.all({...common, program: (_: number) => Effect.succeed('wrong')});
    // @ts-expect-error Without evaluate, each variant's output must fit the result codec.
    void Test.all({
        ...common,
        variants: {A: {program: (_: number) => Effect.succeed('wrong')}},
    });
    // @ts-expect-error A suite must define exactly one program form.
    void Test.all({...common, program: Effect.succeed, variants: {}});
    // @ts-expect-error A suite must define one program form.
    void Test.all(common);
    void Test.all({
        ...common,
        // @ts-expect-error A custom evaluator must accept every program's output.
        variants: {A: {program: (_: number) => Effect.succeed('wrong')}},
        evaluate: (output: number, expected: number) => [
            {key: 'value', result: output, expected, label: 'TP'},
        ],
    });
    void Test.all({
        ...common,
        // @ts-expect-error Without evaluate, each case's expected value must fit the expected codec.
        testCases: [{input: 1, expected: 'wrong'}],
        program: (input: number) => Effect.succeed(input),
    });
});
