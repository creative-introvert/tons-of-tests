import * as P from '../../prelude.js';

/** Variation of built-in `Schema.split`, omitting empty values. */
export const split = (
    separator: string,
): P.Schema.Schema<ReadonlyArray<string>, string> =>
    P.Schema.transform(P.Schema.String, P.Schema.Array(P.Schema.String), {
        decode: s => (s.length === 0 ? [] : s.split(separator)),
        encode: xs => xs.join(separator),
    });
