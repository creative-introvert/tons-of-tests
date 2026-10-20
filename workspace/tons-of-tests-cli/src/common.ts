import * as PT from '@creative-introvert/tons-of-tests';
import {Flag} from 'effect/cli';
import {Option, Schema, SchemaTransformation} from 'effect';

export const cached = Flag.Boolean('cached').pipe(
    Flag.withDefault(false),
    Flag.withDescription(
        'Reuse the latest attempt only if it is Complete, even if it is the baseline. Otherwise start a new run.',
    ),
);

const VariantId = Schema.String.check(
    Schema.isNonEmpty(),
    Schema.makeFilter(
        value => !value.includes(',') && !value.startsWith('run:'),
        {message: 'A variant cannot contain a comma or start with run:.'},
    ),
);

export const variant = Flag.String('variant').pipe(
    Flag.withSchema(VariantId),
    Flag.optional,
    Flag.withDescription(
        'Select a variant by ID. Suites defined with program use default.',
    ),
);

const ExactRunReference = Schema.String.check(
    Schema.makeFilter(
        value =>
            /^run:[1-9]\d*$/.test(value) &&
            Number.isSafeInteger(Number(value.slice(4))),
        {message: 'Use run:<positive integer> for an exact saved run.'},
    ),
).pipe(
    Schema.decodeTo(
        Schema.TaggedStruct('Run', {id: Schema.Int}),
        SchemaTransformation.transform({
            decode: value => ({
                _tag: 'Run' as const,
                id: Number(value.slice(4)),
            }),
            encode: value => `run:${value.id}`,
        }),
    ),
);

const BaselineReference = VariantId.pipe(
    Schema.decodeTo(
        Schema.TaggedStruct('Baseline', {variant: Schema.String}),
        SchemaTransformation.transform({
            decode: value => ({_tag: 'Baseline' as const, variant: value}),
            encode: value => value.variant,
        }),
    ),
);

export const RunReference = Schema.Union([
    ExactRunReference,
    BaselineReference,
]);
export type RunReference = typeof RunReference.Type;

export const exactRun = Flag.String('run').pipe(
    Flag.withSchema(ExactRunReference),
    Flag.optional,
    Flag.withDescription('Commit an exact complete run, for example run:17.'),
);

export class InvalidCommandOptions extends Schema.TaggedError<
    InvalidCommandOptions,
    {readonly brand: unique symbol}
>()('InvalidCommandOptions', {message: Schema.String}) {}

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
            'Show results with any listed label, separated by commas. Diff uses the to side when present and the from side for removed rows.',
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
