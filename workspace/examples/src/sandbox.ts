import * as jdpf from 'jsondiffpatch/formatters/console';
import * as jsd from 'jsondiffpatch';
import colors from 'ansi-colors';
import * as A from 'effect/Array';
import {dual} from 'effect/Function';

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
