import {isDeepStrictEqual} from 'node:util';

import * as S from '@effect/schema/Schema';

export type Label = 'TP' | 'TN' | 'FP' | 'FN';

export const LabelSchema: S.Schema<Label> = S.literal('TP', 'TN', 'FP', 'FN');

type Count = Record<Label, number>;

export function classify<O>(output: O, expected: O): Label {
    if (output === undefined && expected === undefined) {
        return 'TN';
    }

    if (
        output !== undefined &&
        expected !== undefined &&
        isDeepStrictEqual(output, expected)
    ) {
        return 'TP';
    }

    if (
        (output !== undefined && expected === undefined) ||
        (output !== undefined &&
            expected !== undefined &&
            !isDeepStrictEqual(output, expected))
    ) {
        return 'FP';
    }

    return 'FN';
}

export const precision = (m: Count): number => {
    const r = m.TP / (m.TP + m.FP);
    return isNaN(r) ? 0 : r;
};

export const recall = (m: Count): number => {
    const r = m.TP / (m.TP + m.FN);
    return isNaN(r) ? 0 : r;
};

export const count = (labels: Label[]): Count =>
    labels.reduce(
        (_count, label) => {
            _count[label]++;
            return _count;
        },
        {TP: 0, TN: 0, FP: 0, FN: 0},
    );

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
