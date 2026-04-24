import * as c from 'ansi-colors';
import * as t from 'vitest';

import {formatDiff} from './format-diff.js';
import {diff} from './lib/jsondiffpatch/index.js';

t.describe('format-diff', () => {
    t.test.each([
        {description: 'equal numbers', a: 0, b: 0},
        {description: 'equal undefined', a: undefined, b: undefined},
        {description: 'equal empty objects', a: {}, b: {}},
        {description: 'equal empty arrays', a: [], b: []},
    ])('empty diff ($description) returns empty string', ({a, b}) => {
        t.expect(formatDiff(diff(a, b))).toBe('');
    });

    t.test.each([
        {description: 'undefined -> number', a: undefined, b: 1, expected: '1'},
        {description: 'number -> undefined', a: 1, b: undefined, expected: '1'},
        {description: 'number change', a: 1, b: 2, expected: '1 => 2'},
        {
            description: 'empty array -> array',
            a: [],
            b: [1],
            expected: '[\n  0: 1\n]',
        },
        {
            description: 'array -> empty array',
            a: [1],
            b: [],
            expected: '[\n  0: 1\n]',
        },
        {
            description: 'undefined field -> number field',
            a: {foo: undefined},
            b: {foo: 1},
            expected: '{\n  foo: 1\n}',
        },
        {
            description: 'number field -> undefined field',
            a: {foo: 1},
            b: {foo: undefined},
            expected: '{\n  foo: 1\n}',
        },
    ])('non-empty diff ($description)', ({a, b, expected}) => {
        const raw = formatDiff(diff(a, b));
        t.expect(typeof raw).toBe('string');
        t.expect(c.unstyle(raw as string)).toEqual(expected);
    });
});
