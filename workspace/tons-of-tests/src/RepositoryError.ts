import {ResultLengthMismatch, SqlError} from '@effect/sql/SqlError';
import {Schema} from 'effect';
import {ParseError} from 'effect/ParseResult';

const SqlCause = Schema.Union(
    Schema.instanceOf(SqlError),
    Schema.instanceOf(ResultLengthMismatch),
);

export class RepositoryQueryError extends Schema.TaggedError<RepositoryQueryError>()(
    'RepositoryQueryError',
    {operation: Schema.String, cause: Schema.instanceOf(SqlError)},
) {
    static fromSql = (operation: string) => (cause: SqlError) =>
        new RepositoryQueryError({operation, cause});
}

export class RepositoryWriteError extends Schema.TaggedError<RepositoryWriteError>()(
    'RepositoryWriteError',
    {operation: Schema.String, cause: SqlCause},
) {
    static from =
        (operation: string) => (cause: SqlError | ResultLengthMismatch) =>
            new RepositoryWriteError({operation, cause});
}

export class RepositoryDecodeError extends Schema.TaggedError<RepositoryDecodeError>()(
    'RepositoryDecodeError',
    {operation: Schema.String, cause: Schema.instanceOf(ParseError)},
) {
    static from = (operation: string) => (cause: ParseError) =>
        new RepositoryDecodeError({operation, cause});
}

export class TestRunNotCreated extends Schema.TaggedError<TestRunNotCreated>()(
    'TestRunNotCreated',
    {name: Schema.String},
) {}

export type RepositoryError =
    | RepositoryQueryError
    | RepositoryWriteError
    | RepositoryDecodeError
    | TestRunNotCreated;
