import {Option, Schema} from 'effect';

import type {ConfusionLabel} from '../Classify.js';

export const values = {
    TN: 'TN',
    TP: 'TP',
    FP: 'FP',
    FN: 'FN',
} as const;

export const ConfusionLabelSchema = Schema.Literals(['TP', 'TN', 'FP', 'FN']);

export const LabelSchema = Schema.String.check(
    Schema.isMinLength(1),
    Schema.isTrimmed(),
    // oxlint-disable-next-line no-control-regex -- Label names must exclude ASCII control characters.
    Schema.isPattern(/^[^,\u0000-\u001F\u007F]+$/u),
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
    }): ((output: O, expected: T) => ConfusionLabel) =>
    (output, expected) => {
        const oNil = isOutputNil(output);
        const eNil = isExpectedNil(expected);

        if (oNil && eNil) {
            return values.TN;
        }

        if (!oNil && !eNil) {
            return isEqual(output, expected) ? values.TP : values.FP;
        }

        if (!oNil && eNil) {
            return values.FP;
        }

        return values.FN;
    };

export const count = (
    counts: Readonly<Record<string, number>>,
    label: string,
): number => (Object.hasOwn(counts, label) ? counts[label] : 0);

export const precision = (counts: Readonly<Record<string, number>>): number => {
    const tp = count(counts, 'TP');
    const r = tp / (tp + count(counts, 'FP'));
    return Number.isNaN(r) ? 0 : r;
};

export const recall = (counts: Readonly<Record<string, number>>): number => {
    const tp = count(counts, 'TP');
    const r = tp / (tp + count(counts, 'FN'));
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

    return Option.fromNullishOr(r);
};
