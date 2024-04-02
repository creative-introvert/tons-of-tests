import * as P from './prelude.js';

export class DuplicateTestCase<I> extends P.Data.TaggedError(
    'DuplicateTestCase',
)<{
    input: I;
    id: string;
}> {}
