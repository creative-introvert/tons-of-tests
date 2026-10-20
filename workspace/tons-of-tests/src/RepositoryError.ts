import type {SqlError} from 'effect/sql/SqlError';
import {Schema} from 'effect';
import type {TestValueError} from './TestValueError.js';

export {TestValueError} from './TestValueError.js';

export class TestRunNotCreated extends Schema.TaggedError<
    TestRunNotCreated,
    {readonly brand: unique symbol}
>()('TestRunNotCreated', {testSuiteName: Schema.String}) {}

/** A complete saved run is required for this operation. */
export class TestRunIncomplete extends Schema.TaggedError<
    TestRunIncomplete,
    {readonly brand: unique symbol}
>()('TestRunIncomplete', {
    testSuiteName: Schema.String,
    testRunId: Schema.Int,
    variant: Schema.String,
}) {}

export class TestRunNotFound extends Schema.TaggedError<
    TestRunNotFound,
    {readonly brand: unique symbol}
>()('TestRunNotFound', {testRunId: Schema.Int}) {}

export class TestBaselineNotFound extends Schema.TaggedError<
    TestBaselineNotFound,
    {readonly brand: unique symbol}
>()('TestBaselineNotFound', {
    testSuiteName: Schema.String,
    variant: Schema.String,
}) {}

export type RepositoryError =
    | SqlError
    | Schema.SchemaError
    | TestValueError
    | TestRunNotCreated
    | TestRunIncomplete
    | TestRunNotFound
    | TestBaselineNotFound;
