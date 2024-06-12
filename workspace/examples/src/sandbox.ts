import * as A from 'effect/Array';

const rows = [
    [
        ['a', 'b', 'c'],
        ['x', '', ''],
        ['{', 'foo=2', '}'],
    ],
    [
        ['a', 'b', 'c'],
        ['x', '', ''],
        ['{', 'foo=2', '}'],
    ],
];

const r = A.zipWith(rows[0][0], rows[0][1], (ca, cb) => `${ca} | ${cb}`);

console.log(r);
