import {Schema} from 'effect';

const fields = {
    id: Schema.Int,
    name: Schema.String,
    variant: Schema.String,
};

/**
 * Identify a run by both `store` and `id`; the two stores can use the same ID.
 * A new execution replaces the cached attempt for its snapshot identity, suite,
 * and variant. Complete attempts, including empty ones, can be reused or committed.
 * Committed snapshots stay unchanged after a program changes or is removed.
 */
export const TestRun = Schema.Union([
    Schema.Struct({
        ...fields,
        store: Schema.Literal('cache'),
        state: Schema.Literals(['Running', 'Complete', 'Failed']),
    }),
    Schema.Struct({
        ...fields,
        store: Schema.Literal('snapshot'),
        state: Schema.Literal('Complete'),
    }),
]);
export type TestRun = typeof TestRun.Type;
