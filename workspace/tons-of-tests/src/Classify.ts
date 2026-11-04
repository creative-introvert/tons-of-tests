import {Option, Schema} from 'effect';

import * as internal from './internal/Classify.js';

/** These labels alone determine precision and recall. */
export const ConfusionLabelSchema = internal.ConfusionLabelSchema;
export type ConfusionLabel = typeof ConfusionLabelSchema.Type;

/**
 * Names keep their exact spelling and case. They must be non-empty, have no
 * leading or trailing whitespace, and contain no commas or ASCII control characters.
 */
export const LabelSchema = internal.LabelSchema;
export type Label = typeof LabelSchema.Type;

export const values = internal.values;
export const defaultIsNil = internal.defaultIsNil;
export const makeClassify = internal.makeClassify;

export type Classify<O, T> = (output: O, expected: T) => Label;

/** Counts selected results; timing statistics count each selected case once. */
export class Stats extends Schema.Class<Stats>('Stats')({
    /** Counts by exact label, for example `stats.counts['failure-timeout']`. */
    counts: Schema.Record(LabelSchema, Schema.Int),
    /** Number of evaluation results. */
    total: Schema.Finite,
    /** Number of distinct original test cases represented by those results. */
    testCases: Schema.Int,
    /** TP / (TP + FP), or zero when the denominator is zero. */
    precision: Schema.Finite,
    /** TP / (TP + FN), or zero when the denominator is zero. */
    recall: Schema.Finite,
    timeMin: Schema.Option(Schema.Finite),
    timeMax: Schema.Option(Schema.Finite),
    timeMedian: Schema.Option(Schema.Finite),
    timeMean: Schema.Option(Schema.Finite),
}) {
    static empty(): Stats {
        return new Stats({
            counts: {TP: 0, TN: 0, FP: 0, FN: 0},
            total: 0,
            testCases: 0,
            precision: 0,
            recall: 0,
            timeMin: Option.none(),
            timeMax: Option.none(),
            timeMedian: Option.none(),
            timeMean: Option.none(),
        });
    }
}
