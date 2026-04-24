import * as t from 'vitest';
import {Option} from 'effect';

import {
    defaultIsEqual,
    makeClassify,
    median,
    precision,
    recall,
    values,
} from './Classify.js';

const classify = makeClassify<unknown, unknown>({
    isEqual: (o, e) => defaultIsEqual(o, e),
});

t.describe('makeClassify', () => {
    t.test.each([
        {
            description: 'both nil -> TN',
            output: null,
            expected: null,
            label: values.TN,
        },
        {
            description: 'both nil (undefined) -> TN',
            output: undefined,
            expected: undefined,
            label: values.TN,
        },
        {
            description: 'equal non-nil -> TP',
            output: 1,
            expected: 1,
            label: values.TP,
        },
        {
            description: 'equal objects -> TP',
            output: {a: 1},
            expected: {a: 1},
            label: values.TP,
        },
        {
            description: 'unequal non-nil -> FP',
            output: 2,
            expected: 1,
            label: values.FP,
        },
        {
            description: 'output present, expected nil -> FP',
            output: 1,
            expected: null,
            label: values.FP,
        },
        {
            description: 'output nil, expected present -> FN',
            output: null,
            expected: 1,
            label: values.FN,
        },
        {
            description: 'output nil, expected present (undefined) -> FN',
            output: undefined,
            expected: 0,
            label: values.FN,
        },
    ])('$description', ({output, expected, label}) => {
        t.expect(classify(output, expected)).toBe(label);
    });
});

t.describe('defaultIsEqual', () => {
    // Documents the FIXME: JSON round-trip strips `undefined`-valued keys,
    // so {a: undefined, b: 1} compares equal to {b: 1}. A refactor that
    // switches to a cheaper deep-equal would flip this silently.
    t.test.each([
        {
            description: 'strips undefined keys from a',
            a: {a: undefined, b: 1},
            b: {b: 1},
            expected: true,
        },
        {
            description: 'strips undefined keys from b',
            a: {b: 1},
            b: {a: undefined, b: 1},
            expected: true,
        },
        {description: 'equal primitives', a: 1, b: 1, expected: true},
        {description: 'different primitives', a: 1, b: 2, expected: false},
        {
            description: 'different object shapes',
            a: {a: 1},
            b: {a: 2},
            expected: false,
        },
    ])('$description', ({a, b, expected}) => {
        t.expect(defaultIsEqual(a, b)).toBe(expected);
    });
});

t.describe('precision', () => {
    t.test.each([
        {description: 'no predictions -> 0', m: {TP: 0, FP: 0}, expected: 0},
        {description: 'all TP -> 1', m: {TP: 3, FP: 0}, expected: 1},
        {description: 'half FP -> 0.5', m: {TP: 1, FP: 1}, expected: 0.5},
    ])('$description', ({m, expected}) => {
        t.expect(precision(m)).toBe(expected);
    });
});

t.describe('recall', () => {
    t.test.each([
        {
            description: 'no actual positives -> 0',
            m: {TP: 0, FN: 0},
            expected: 0,
        },
        {description: 'all TP -> 1', m: {TP: 3, FN: 0}, expected: 1},
        {description: 'half FN -> 0.5', m: {TP: 1, FN: 1}, expected: 0.5},
    ])('$description', ({m, expected}) => {
        t.expect(recall(m)).toBe(expected);
    });
});

t.describe('median', () => {
    t.test.each([
        {description: 'empty -> none', xs: [], expected: Option.none<number>()},
        {description: 'single -> value', xs: [7], expected: Option.some(7)},
        {
            description: 'two elements -> average',
            xs: [1, 2],
            expected: Option.some(1.5),
        },
        {
            description: 'odd length -> middle',
            xs: [3, 1, 2],
            expected: Option.some(2),
        },
        {
            description: 'even length -> average of middle two',
            xs: [1, 2, 3, 4],
            expected: Option.some(2.5),
        },
        {
            description: 'unsorted even length',
            xs: [4, 1, 3, 2],
            expected: Option.some(2.5),
        },
    ])('$description', ({xs, expected}) => {
        t.expect(median(xs)).toStrictEqual(expected);
    });
});
