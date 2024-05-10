import * as t from 'vitest';
import * as c from 'ansi-colors';

import {formatDiff} from './format-diff.js';
import {diff} from './lib/jsondiffpatch/index.js';

t.describe('format-diff', () => {
    t.test.each([
        {a: 0, b: 0, expected: ''},
        {a: undefined, b: undefined, expected: ''},
        {a: {}, b: {}, expected: ''},
        {a: [], b: [], expected: ''},
    ])('empty diff', ({a, b, expected}) => {
        const result = formatDiff(diff(a, b));
        t.expect(result).toEqual(expected);
    });

    t.test.each([
        {a: undefined, b: 1, expected: '1'},
        {a: 1, b: undefined, expected: '1'},
        {a: 1, b: 2, expected: '1 => 2'},
        {a: [], b: [1], expected: `[\n  0: 1\n]`},
        {a: [1], b: [], expected: `[\n  0: 1\n]`},
        {a: {foo: undefined}, b: {foo: 1}, expected: `{\n  foo: 1\n}`},
        {a: {foo: 1}, b: {foo: undefined}, expected: `{\n  foo: 1\n}`},
    ])('non-empty diff', ({a, b, expected}) => {
        const result = c.unstyle(formatDiff(diff(a, b))!);
        t.expect(result).toEqual(expected);
    });
});
