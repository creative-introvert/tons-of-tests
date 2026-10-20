import {Schema} from 'effect';

/**
 * One saved execution of a suite variant. Results remain available after its
 * program changes or is removed. `Complete` and `Failed` runs cannot be changed.
 * Committing a complete run changes only its variant's baseline pointer.
 */
export class TestRun extends Schema.Class<
    TestRun,
    {readonly brand: unique symbol}
>('TestRun')({
    id: Schema.Int,
    name: Schema.String,
    variant: Schema.String,
    state: Schema.Literals(['Running', 'Complete', 'Failed']),
}) {}
