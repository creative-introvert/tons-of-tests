import {Effect, Schema, SchemaIssue} from 'effect';

import type {TestResult} from '../Test.js';
import type {TestResultSchemas} from '../Test.repository.js';
import {TestValueError} from '../TestValueError.js';

/** Stable JSON object order, including records; array order remains significant. */
export const stringifyJson = (value: Schema.Json): string => {
    if (Array.isArray(value)) return `[${value.map(stringifyJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries<Schema.Json>(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(
                ([key, entry]) =>
                    `${JSON.stringify(key)}:${stringifyJson(entry)}`,
            )
            .join(',')}}`;
    }
    return JSON.stringify(value);
};

type ValueContext = Pick<
    TestValueError,
    'suite' | 'caseNumber' | 'key' | 'field'
>;

const decodeJsonText = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Json),
);

export const makeValueCodec = <T>(schema: Schema.Codec<T, unknown>) => {
    const json = Schema.toCodecJson(schema);
    const options = {onExcessProperty: 'error'} as const;
    const encodeJson = Schema.encodeEffect(json, options);
    const decodeJson = Schema.decodeEffect(json, options);
    const decodeText = Schema.decodeUnknownEffect(
        Schema.fromJsonString(json),
        options,
    );
    const equals = Schema.toEquivalence(schema);
    const encode = Effect.fnUntraced(function* (
        value: T,
        context: ValueContext,
    ) {
        const encoded = yield* encodeJson(value).pipe(
            Effect.mapError(
                cause =>
                    new TestValueError({
                        ...context,
                        operation: 'encode',
                        cause,
                    }),
            ),
        );
        // Use the actual stored key order for both fresh and cached reports.
        const canonical = yield* decodeJsonText(stringifyJson(encoded)).pipe(
            Effect.mapError(
                cause =>
                    new TestValueError({
                        ...context,
                        operation: 'roundTrip',
                        cause,
                    }),
            ),
        );
        const restored = yield* decodeJson(canonical).pipe(
            Effect.mapError(
                cause =>
                    new TestValueError({
                        ...context,
                        operation: 'roundTrip',
                        cause,
                    }),
            ),
        );
        if (!equals(value, restored)) {
            return yield* new TestValueError({
                ...context,
                operation: 'roundTrip',
                cause: new Schema.SchemaError(
                    new SchemaIssue.InvalidValue({
                        message: 'Decoding the saved JSON changed the value',
                    }),
                ),
            });
        }
        return canonical;
    });
    const decode = (text: unknown, context: ValueContext) =>
        decodeText(text).pipe(
            Effect.mapError(
                cause =>
                    new TestValueError({
                        ...context,
                        operation: 'decode',
                        cause,
                    }),
            ),
        );
    return {encode, decode};
};

/** Reuse the same conversions for result IDs, storage, and reports. */
export const makeResultCodec = <I, O, T>(
    schemas: TestResultSchemas<I, O, T>,
    suite: string,
) => {
    const input = makeValueCodec(schemas.testCase.input);
    const result = makeValueCodec(schemas.evaluation.result);
    const expected = makeValueCodec(schemas.evaluation.expected);
    const encode = Effect.fnUntraced(function* <
        A extends Pick<
            TestResult<I, O, T>,
            'input' | 'result' | 'expected' | 'key' | 'ordering'
        >,
    >(value: A) {
        const {
            input: inputValue,
            result: resultValue,
            expected: expectedValue,
            ...metadata
        } = value;
        const context = {
            suite,
            caseNumber: value.ordering + 1,
            key: value.key,
        };
        return {
            ...metadata,
            input: yield* input.encode(inputValue, {
                ...context,
                field: 'testCase.input',
            }),
            result: yield* result.encode(resultValue, {
                ...context,
                field: 'evaluation.result',
            }),
            expected: yield* expected.encode(expectedValue, {
                ...context,
                field: 'evaluation.expected',
            }),
        };
    });
    const decode = Effect.fnUntraced(function* (
        value: TestResult<string, string, string>,
    ) {
        const context = {
            suite,
            caseNumber: value.ordering + 1,
            key: value.key,
        };
        return {
            ...value,
            input: yield* input.decode(value.input, {
                ...context,
                field: 'testCase.input',
            }),
            result: yield* result.decode(value.result, {
                ...context,
                field: 'evaluation.result',
            }),
            expected: yield* expected.decode(value.expected, {
                ...context,
                field: 'evaluation.expected',
            }),
        };
    });
    return {encode, decode};
};
