import {isDeepStrictEqual} from 'node:util';

import * as S from '@effect/schema/Schema';

export const TN = Symbol.for('TN');
export const TP = Symbol.for('TP');
export const FP = Symbol.for('FP');
export const FN = Symbol.for('FN');

export type Label = typeof TP | typeof TN | typeof FP | typeof FN | string;

type Count = Map<Label, number>;

export function classify<O, E>(output: O | E, expected: O): Label {
    if (output === undefined && expected === undefined) {
        return TN;
    }

    if (
        output !== undefined &&
        expected !== undefined &&
        isDeepStrictEqual(output, expected)
    ) {
        return TP;
    }

    if (
        (output !== undefined && expected === undefined) ||
        (output !== undefined &&
            expected !== undefined &&
            !isDeepStrictEqual(output, expected))
    ) {
        return FP;
    }

    return FN;
}

// export const precision = (m: Count): number => {
//     const r = m.get(TP)! / (m.get(TP)! + m.get(FP)!);
//     return isNaN(r) ? 0 : r;
// };

// export const recall = (m: Count): number => {
//     const r = m.TP / (m.TP + m.FN);
//     return isNaN(r) ? 0 : r;
// };

// export const count = (labels: Label[]): Count =>
//     labels.reduce(
//         (_count, label) => {
//             _count[label]++;
//             return _count;
//         },
//         {TP: 0, TN: 0, FP: 0, FN: 0},
//     );

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
