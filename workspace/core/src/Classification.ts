import * as S from '@effect/schema/Schema';

export enum Label {
    'TP' = 'TP',
    'TN' = 'TN',
    'FP' = 'FP',
    'FN' = 'FN',
}

export const LabelSchema = S.enums(Label);

type Count = {
    [Label.TP]: number;
    [Label.TN]: number;
    [Label.FP]: number;
    [Label.FN]: number;
};

export function classify(output?: unknown, expected?: unknown): Label {
    // FIXME: This only works for primitives.
    // use https://effect-ts.github.io/effect/effect/Data.ts.html
    if (output === expected) {
        return output !== undefined ? Label.TP : Label.TN;
    }
    if (output !== undefined && expected === undefined) {
        return Label.FP;
    }
    return Label.FN;
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
        {
            [Label.TP]: 0,
            [Label.TN]: 0,
            [Label.FP]: 0,
            [Label.FN]: 0,
        },
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
