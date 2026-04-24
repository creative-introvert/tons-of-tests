import {Option, Schema} from 'effect';

import * as internal from './internal/Classify.js';

export const LabelSchema = internal.LabelSchema;
export type Label = Schema.Schema.Type<typeof LabelSchema>;

export const values = internal.values;
export const defaultIsEqual = internal.defaultIsEqual;
export const defaultIsNil = internal.defaultIsNil;
export const makeClassify = internal.makeClassify;

export type Classify<O, T> = (output: O, expected: T) => Label;

export class Stats extends Schema.Class<Stats>('Stats')({
    TP: Schema.Number,
    TN: Schema.Number,
    FP: Schema.Number,
    FN: Schema.Number,
    total: Schema.Number,
    precision: Schema.Number,
    recall: Schema.Number,
    timeMin: Schema.OptionFromSelf(Schema.Number),
    timeMax: Schema.OptionFromSelf(Schema.Number),
    timeMedian: Schema.OptionFromSelf(Schema.Number),
    timeMean: Schema.OptionFromSelf(Schema.Number),
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
