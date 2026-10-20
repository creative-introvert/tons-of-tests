import type {SqlError} from 'effect/sql/SqlError';
import {Schema} from 'effect';
import type {TestValueError} from './TestValueError.js';

export {TestValueError} from './TestValueError.js';

export class TestRunNotCreated extends Schema.TaggedError<
    TestRunNotCreated,
    {readonly brand: unique symbol}
>()('TestRunNotCreated', {testSuiteName: Schema.String}) {}

/** Run the suite successfully before committing its results. */
export class TestRunIncomplete extends Schema.TaggedError<
    TestRunIncomplete,
    {readonly brand: unique symbol}
>()('TestRunIncomplete', {testSuiteName: Schema.String}) {}

export type RepositoryError =
    | SqlError
    | Schema.SchemaError
    | TestValueError
    | TestRunNotCreated
    | TestRunIncomplete;
