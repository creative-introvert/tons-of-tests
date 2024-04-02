import {isDeepStrictEqual} from 'node:util';

export const Label = {
    TN: 'TN',
    TP: 'TP',
    FP: 'FP',
    FN: 'FN',
} as const;

export type Label = (typeof Label)[keyof typeof Label];

export const isNil = <I>(x: I): boolean => x === null || x === undefined;

export function classify<O, E>(output: O | E, expected: O): Label {
    if (isNil(output) && isNil(expected)) {
        return Label.TN;
    }

    if (
        !isNil(output) &&
        !isNil(expected) &&
        isDeepStrictEqual(output, expected)
    ) {
        return Label.TP;
    }

    if (
        (!isNil(output) && isNil(expected)) ||
        (!isNil(output) &&
            !isNil(expected) &&
            !isDeepStrictEqual(output, expected))
    ) {
        return Label.FP;
    }

    return Label.FN;
}

export type Stats = Record<Label, number> & {
    precision: number;
    recall: number;
};

export const Stats = {
    empty: (): Stats => ({
        TP: 0,
        TN: 0,
        FP: 0,
        FN: 0,
        precision: 0,
        recall: 0,
    }),
};

export const precision = (m: Stats): number => {
    const r = m.TP / (m.TP + m.FP);
    return isNaN(r) ? 0 : r;
};

export const recall = (m: Stats): number => {
    const r = m.TP / (m.TP + m.FN);
    return isNaN(r) ? 0 : r;
};

// type Count = Map<Label, number>;

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
