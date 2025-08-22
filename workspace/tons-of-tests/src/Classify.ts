import type {Option} from 'effect';

import * as internal from './internal/Classify.js';

export type Label =
    /** True Positive. Non-nill output, as expected. */
    | 'TP'
    /** True Negative. Nill output, as expected. */
    | 'TN'
    /** False Positive. Non-nill output, not expected. */
    | 'FP'
    /** False Negative. Nill output, not expected. */
    | 'FN';

export const values = internal.values;
export const defaultIsEqual = internal.defaultIsEqual;
export const defaultIsNil = internal.defaultIsNil;
export const makeClassify = internal.makeClassify;

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
