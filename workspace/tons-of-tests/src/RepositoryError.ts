import type {SqlError} from 'effect/sql/SqlError';
import type {PlatformError} from 'effect/PlatformError';
import {Schema} from 'effect';
import type {TestValueError} from './TestValueError.js';

export {TestValueError} from './TestValueError.js';

export class TestRunNotCreated extends Schema.TaggedError<
    TestRunNotCreated,
    {readonly brand: unique symbol}
>()('TestRunNotCreated', {testSuiteName: Schema.String}) {}

/** This operation requires a complete cached attempt or committed snapshot. */
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

/** The store uses an unsupported format. Snapshot files are left unchanged. */
export class RepositoryFormatError extends Schema.TaggedError<
    RepositoryFormatError,
    {readonly brand: unique symbol}
>()('RepositoryFormatError', {
    store: Schema.Literals(['cache', 'snapshot']),
    path: Schema.String,
}) {}

/** A commit selects more than one run for the same suite and variant. */
export class TestRunDuplicate extends Schema.TaggedError<
    TestRunDuplicate,
    {readonly brand: unique symbol}
>()('TestRunDuplicate', {
    testSuiteName: Schema.String,
    variant: Schema.String,
}) {}

/** Cache and snapshot paths refer to the same file; no writer has been opened. */
export class RepositoryPathConflict extends Schema.TaggedError<
    RepositoryPathConflict,
    {readonly brand: unique symbol}
>()('RepositoryPathConflict', {
    snapshotPath: Schema.String,
    cachePath: Schema.String,
}) {}

export type RepositoryError =
    | SqlError
    | PlatformError
    | Schema.SchemaError
    | TestValueError
    | TestRunNotCreated
    | TestRunIncomplete
    | TestRunNotFound
    | TestBaselineNotFound
    | RepositoryFormatError
    | RepositoryPathConflict
    | TestRunDuplicate;
