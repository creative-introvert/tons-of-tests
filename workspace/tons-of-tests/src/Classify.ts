import type {Option} from 'effect';

import * as internal from './internal/Classify.js';

export type Label = 'TP' | 'TN' | 'FP' | 'FN';

export const values = internal.values;
export const defaultIsEqual = internal.defaultIsEqual;

export type Classify<O, T> = (output: O, expected: T) => Label;

export type Stats = Record<Label, number> & {
    total: number;
    precision: number;
    recall: number;
    timeMin: Option.Option<number>;
    timeMax: Option.Option<number>;
    timeMedian: Option.Option<number>;
    timeMean: Option.Option<number>;
};

export const LabelSchema = internal.LabelSchema;
