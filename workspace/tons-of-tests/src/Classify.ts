import {Option, Schema} from 'effect';

import * as internal from './internal/Classify.js';

export const LabelSchema = internal.LabelSchema;
export type Label = typeof LabelSchema.Type;

export const values = internal.values;
export const defaultIsEqual = internal.defaultIsEqual;
export const defaultIsNil = internal.defaultIsNil;
export const makeClassify = internal.makeClassify;

export type Classify<O, T> = (output: O, expected: T) => Label;

export class Stats extends Schema.Class<Stats>('Stats')({
    TP: Schema.Finite,
    TN: Schema.Finite,
    FP: Schema.Finite,
    FN: Schema.Finite,
    total: Schema.Finite,
    precision: Schema.Finite,
    recall: Schema.Finite,
    timeMin: Schema.Option(Schema.Finite),
    timeMax: Schema.Option(Schema.Finite),
    timeMedian: Schema.Option(Schema.Finite),
    timeMean: Schema.Option(Schema.Finite),
}) {
    static empty(): Stats {
        return new Stats({
            TP: 0,
            TN: 0,
            FP: 0,
            FN: 0,
            total: 0,
            precision: 0,
            recall: 0,
            timeMin: Option.none(),
            timeMax: Option.none(),
            timeMedian: Option.none(),
            timeMean: Option.none(),
        });
    }
}
