import {Schema} from 'effect';

/** A saved run of one test suite. A null hash identifies its current run. */
export class TestRun extends Schema.Class<
    TestRun,
    {readonly brand: unique symbol}
>('TestRun')({
    id: Schema.Int,
    name: Schema.String,
    hash: Schema.NullOr(Schema.String),
}) {}
