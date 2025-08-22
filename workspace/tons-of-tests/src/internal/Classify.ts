import {isDeepStrictEqual} from 'node:util';

import {Option, Schema} from 'effect';

import type {
    Classify as TClassify,
    Label as TLabel,
    Stats as _Stats,
} from '../Classify.js';

export const values = {
    TN: 'TN',
    TP: 'TP',
    FP: 'FP',
    FN: 'FN',
} as const;

export const LabelSchema: Schema.Schema<TLabel> = Schema.Literal(
    'TP',
    'TN',
    'FP',
    'FN',
);

export const defaultIsEqual = <A, B>(a: A, b: B): boolean =>
    // FIXME: Expensive, but don't know how else to cheaply remove
    // `undefined`, which is a common source of false results.
    // Parsing the output w/ a schema would be better, or
    // forbidding `undefined`.
    isDeepStrictEqual(
        JSON.parse(JSON.stringify(a)),
        JSON.parse(JSON.stringify(b)),
    );

export const defaultIsNil = <I>(x: I): boolean => x === null || x === undefined;

export const makeClassify =
    <O, T>({
        isEqual,
        isOutputNil = defaultIsNil,
        isExpectedNil = defaultIsNil,
    }: {
        /**
         * Ideally, `isEqual` should remain the same over the lifetime of a test suite.
         * As previous test results are not re-evaluated (at this time) using an updated
         * `isEqual`, they might be confusing.
         */
        isEqual: (output: O, expected: T) => boolean;
        isOutputNil?: (output: O) => boolean;
        isExpectedNil?: (expected: T) => boolean;
    }): TClassify<O, T> =>
    (output, expected) => {
        const eq = isEqual(output, expected);
        const oNil = isOutputNil(output);
        const eNil = isExpectedNil(expected);

        if (oNil && eNil) {
            return values.TN;
        }

        if (!oNil && !eNil && eq) {
            return values.TP;
        }

        if ((!oNil && eNil) || (!oNil && !eNil && !eq)) {
            return values.FP;
        }

        return values.FN;
    };

export const StatsSchema = Schema.Struct({
    TP: Schema.Number,
    TN: Schema.Number,
    FP: Schema.Number,
    FN: Schema.Number,
    precision: Schema.Number,
    recall: Schema.Number,
    timeMean: Schema.Number.pipe(Schema.Option),
    timeMedian: Schema.Number.pipe(Schema.Option),
    timeMin: Schema.Number.pipe(Schema.Option),
    timeMax: Schema.Number.pipe(Schema.Option),
});

export const Stats = {
    empty: (): _Stats => ({
        TP: 0,
        TN: 0,
        FP: 0,
        FN: 0,
        precision: 0,
        recall: 0,
        timeMean: Option.none(),
        timeMedian: Option.none(),
        timeMin: Option.none(),
        timeMax: Option.none(),
        total: 0,
    }),
};

export const precision = (m: _Stats): number => {
    const r = m.TP / (m.TP + m.FP);
    return Number.isNaN(r) ? 0 : r;
};

export const recall = (m: _Stats): number => {
    const r = m.TP / (m.TP + m.FN);
    return Number.isNaN(r) ? 0 : r;
};

export const min = (xs: number[]): number =>
    xs.reduce((min, x) => (x < min ? x : min), Number.POSITIVE_INFINITY);

export const max = (xs: number[]): number =>
    xs.reduce((max, x) => (x > max ? x : max), Number.NEGATIVE_INFINITY);

export const mean = (xs: number[]): number | undefined => {
    if (xs.length === 0) {
        return undefined;
    }

    return xs.reduce((a, b) => a + b, 0) / xs.length;
};

export const median = (xs: number[]): Option.Option<number> => {
    if (xs.length === 0) {
        return Option.none();
    }

    const sorted = xs.slice().sort((a, b) => a - b);
    const index = Math.floor(sorted.length / 2);

    const r =
        sorted.length % 2 === 0
            ? (sorted[index - 1] + sorted[index]) / 2
            : sorted[index];

    return Option.fromNullable(r);
};
