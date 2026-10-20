import * as PT from '@creative-introvert/tons-of-tests';
import {Flag} from 'effect/cli';
import {Option, Schema, SchemaTransformation} from 'effect';

export const cached = Flag.Boolean('cached').pipe(
    Flag.withDefault(false),
    Flag.withDescription(
        'Reuse a completed current run; otherwise run the suite.',
    ),
);

const CommaSeparatedStringsSchema = Schema.String.pipe(
    Schema.decodeTo(
        Schema.Array(Schema.String),
        SchemaTransformation.transform({
            decode: (s): readonly string[] =>
                s.length === 0 ? [] : s.split(','),
            encode: xs => xs.join(','),
        }),
    ),
);

const LabelSchema = Schema.String.pipe(
    Schema.decodeTo(
        Schema.Array(Schema.String),
        SchemaTransformation.transform({
            decode: (s): readonly string[] => s.split(','),
            encode: xs => xs.join(','),
        }),
    ),
    Schema.decodeTo(Schema.Array(PT.Classify.LabelSchema)),
);

export const resultFilterFlags = {
    keys: Flag.String('keys').pipe(
        Flag.withSchema(CommaSeparatedStringsSchema),
        Flag.optional,
        Flag.withDescription(
            'Show results with any listed key (comma-separated).',
        ),
    ),
    labels: Flag.String('labels').pipe(
        Flag.withSchema(LabelSchema),
        Flag.optional,
        Flag.withDescription(
            'Show results with any listed current label (comma-separated).',
        ),
    ),
    orTags: Flag.String('tags').pipe(
        Flag.withSchema(CommaSeparatedStringsSchema),
        Flag.optional,
        Flag.withDescription(
            'Show results from cases with any listed tag (comma-separated).',
        ),
    ),
    andTags: Flag.String('all-tags').pipe(
        Flag.withSchema(CommaSeparatedStringsSchema),
        Flag.optional,
        Flag.withDescription(
            'Show results from cases with every listed tag (comma-separated).',
        ),
    ),
};

export type ResultFilters = {
    keys?: Option.Option<readonly string[]>;
    labels?: Option.Option<readonly PT.Classify.Label[]>;
    orTags?: Option.Option<readonly string[]>;
    andTags?: Option.Option<readonly string[]>;
};

export const matchesFilters = (
    result: Pick<PT.Test.TestResult, 'key' | 'label' | 'tags'>,
    {
        keys = Option.none(),
        labels = Option.none(),
        orTags = Option.none(),
        andTags = Option.none(),
    }: ResultFilters,
): boolean =>
    (Option.isNone(keys) || keys.value.includes(result.key)) &&
    (Option.isNone(labels) || labels.value.includes(result.label)) &&
    (Option.isNone(orTags) ||
        result.tags.some(tag => orTags.value.includes(tag))) &&
    (Option.isNone(andTags) ||
        andTags.value.every(tag => result.tags.includes(tag)));
