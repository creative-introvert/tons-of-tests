import { Data } from "effect";

export class DuplicateTestCase<I> extends Data.TaggedError(
    'DuplicateTestCase',
)<{
    input: I;
    id: string;
}> {}
