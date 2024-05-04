import * as internal from './internal/Classify.js';

export type Label = 'TP' | 'TN' | 'FP' | 'FN';

export const values = internal.values;

export type Classify<O, T> = (output: O, expected: T) => Label;

export type Stats = Record<Label, number> & {
    precision: number;
    recall: number;
};

export const LabelSchema = internal.LabelSchema;
