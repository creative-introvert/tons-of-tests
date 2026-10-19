import {Schema, SchemaTransformation} from 'effect';

/** An empty tag list is stored as an empty string. */
export const split = (
    separator: string,
): Schema.Codec<readonly string[], string> =>
    Schema.String.pipe(
        Schema.decodeTo(
            Schema.Array(Schema.String),
            SchemaTransformation.transform({
                decode: (s): readonly string[] =>
                    s.length === 0 ? [] : s.split(separator),
                encode: xs => xs.join(separator),
            }),
        ),
    );
