import { Schema } from "effect";

/** Variation of built-in `Schema.split`, omitting empty values. */
export const split = (
    separator: string,
): Schema.Schema<ReadonlyArray<string>, string> =>
    Schema.transform(Schema.String, Schema.Array(Schema.String), {
        decode: s => (s.length === 0 ? [] : s.split(separator)),
        encode: xs => xs.join(separator),
    });
