import {ResultLengthMismatch, SqlError} from 'effect/sql/SqlError';
import {Schema} from 'effect';

const SqlCause = Schema.Union([
    Schema.instanceOf(SqlError),
    Schema.instanceOf(ResultLengthMismatch),
]);

export class RepositoryQueryError extends Schema.TaggedError<
    RepositoryQueryError,
    {readonly brand: unique symbol}
>()('RepositoryQueryError', {
    operation: Schema.String,
    cause: Schema.instanceOf(SqlError),
}) {
    static fromSql = (operation: string) => (cause: SqlError) =>
        new RepositoryQueryError({operation, cause});
}

export class RepositoryWriteError extends Schema.TaggedError<
    RepositoryWriteError,
    {readonly brand: unique symbol}
>()('RepositoryWriteError', {operation: Schema.String, cause: SqlCause}) {
    static from =
        (operation: string) => (cause: SqlError | ResultLengthMismatch) =>
            new RepositoryWriteError({operation, cause});
}

export class RepositoryDecodeError extends Schema.TaggedError<
    RepositoryDecodeError,
    {readonly brand: unique symbol}
>()('RepositoryDecodeError', {
    operation: Schema.String,
    cause: Schema.instanceOf(Schema.SchemaError),
}) {
    static from = (operation: string) => (cause: Schema.SchemaError) =>
        new RepositoryDecodeError({operation, cause});
}

export class TestRunNotCreated extends Schema.TaggedError<
    TestRunNotCreated,
    {readonly brand: unique symbol}
>()('TestRunNotCreated', {testSuiteName: Schema.String}) {}

export type RepositoryError =
    | RepositoryQueryError
    | RepositoryWriteError
    | RepositoryDecodeError
    | TestRunNotCreated;
