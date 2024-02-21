import * as P from './prelude.js';

export class DuplicateTestCase extends P.Data.TaggedError('DuplicateTestCase')<{
    id: string;
}> {}
