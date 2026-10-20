import {Schema} from 'effect';

/** A suite value could not be converted without losing information. */
export class TestValueError extends Schema.TaggedError<
    TestValueError,
    {readonly brand: unique symbol}
>()('TestValueError', {
    suite: Schema.String,
    caseNumber: Schema.Int,
    key: Schema.optionalKey(Schema.String),
    field: Schema.Literals([
        'testCase.input',
        'testCase.expected',
        'evaluation.result',
        'evaluation.expected',
    ]),
    operation: Schema.Literals(['encode', 'decode', 'roundTrip']),
    cause: Schema.instanceOf(Schema.SchemaError),
}) {
    override get message() {
        const key = this.key === undefined ? '' : `, result ${this.key}`;
        return `${this.suite}, case ${this.caseNumber}${key}, ${this.field} (${this.operation}): ${this.cause.message}`;
    }
}
