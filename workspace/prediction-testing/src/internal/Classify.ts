import {isDeepStrictEqual} from 'node:util';

import {equals, isEqual} from 'effect/Equal';

import * as P from '../prelude.js';
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

export const LabelSchema: P.Schema.Schema<TLabel> = P.Schema.Literal(
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
    <O, T>(
        isEqual: (output: O, expected: T) => boolean,
        isOutputNil: (output: O) => boolean = defaultIsNil,
        isExpectedNil: (expected: T) => boolean = defaultIsNil,
    ): TClassify<O, T> =>
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

export const StatsSchema: P.Schema.Schema<_Stats> = P.Schema.Struct({
    TP: P.Schema.Number,
    TN: P.Schema.Number,
    FP: P.Schema.Number,
    FN: P.Schema.Number,
    precision: P.Schema.Number,
    recall: P.Schema.Number,
});

export const Stats = {
    empty: (): _Stats => ({
        TP: 0,
        TN: 0,
        FP: 0,
        FN: 0,
        precision: 0,
        recall: 0,
    }),
};

export const precision = (m: _Stats): number => {
    const r = m.TP / (m.TP + m.FP);
    return isNaN(r) ? 0 : r;
};

export const recall = (m: _Stats): number => {
    const r = m.TP / (m.TP + m.FN);
    return isNaN(r) ? 0 : r;
};

export const min = (xs: number[]): number =>
    xs.reduce((min, x) => (x < min ? x : min), Infinity);

export const max = (xs: number[]): number =>
    xs.reduce((max, x) => (x > max ? x : max), -Infinity);

export const mean = (xs: number[]): number | undefined => {
    if (xs.length === 0) {
        return undefined;
    }

    return xs.reduce((a, b) => a + b, 0) / xs.length;
};

export const median = (xs: number[]): number | undefined => {
    if (xs.length === 0) {
        return undefined;
    }

    const sorted = xs.slice().sort((a, b) => a - b);
    const index = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
        ? (sorted[index - 1] + sorted[index]) / 2
        : sorted[index];
};
