import colors from 'ansi-colors';

import * as P from '../prelude.js';
import {formatDiff} from './format-diff.js';
import type {DisplayConfig} from '../DisplayConfig.js';
import {showBorder, showHeader, showRow, showTitle} from './common.js';
import type {TestRunResults} from '../Test.js';
import {makeDefault} from './DisplayConfig.js';
import type {
    SummarizeColumn,
    SummarizeColumnNames,
    SummarizeContext,
} from '../Show.js';
import {diff} from './lib/jsondiffpatch/index.js';

const columns: SummarizeColumn[] = [
    {
        name: 'index',
        label: '#',
        make: ({i, hashes}: SummarizeContext) => [`${i + 1}/${hashes.length}`],
    },
    {
        name: 'hash',
        label: 'hash',
        make: ({i, hashes}: SummarizeContext) => [hashes[i].slice(0, 8)],
    },
    {
        name: 'timeMillis',
        label: 'ms',
        make: ({testResult}: SummarizeContext) => [
            `${testResult.timeMillis.toFixed(2)}ms`,
        ],
    },
    {
        name: 'input',
        label: 'input',
        make: ({testResult}: SummarizeContext) =>
            JSON.stringify(testResult.input, null, 2).split('\n'),
    },
    {
        name: 'tags',
        label: 'tags',
        make: ({testResult}: SummarizeContext) => testResult.tags as string[],
    },
    {
        name: 'label',
        label: 'label',
        make: ({testResult, previousTestResult}: SummarizeContext) => {
            const hasPrevious = P.Option.isSome(previousTestResult);
            const label = testResult.label;
            const color =
                label === 'TP' || label === 'TN'
                    ? hasPrevious
                        ? colors.green
                        : colors.blue
                    : hasPrevious
                      ? colors.red
                      : colors.yellow;

            return [color(label)];
        },
    },
    {
        name: 'expected',
        label: 'expected',
        make: ({testResult}: SummarizeContext) =>
            JSON.stringify(testResult.expected, null, 2).split('\n'),
    },
    {
        name: 'result',
        label: 'result',
        make: ({testResult}: SummarizeContext) =>
            JSON.stringify(testResult.result, null, 2).split('\n'),
    },
    {
        name: 'result_diff',
        label: 'diff result',
        make: ({testResult}: SummarizeContext) =>
            formatDiff(diff(testResult.expected, testResult.result))?.split(
                '\n',
            ) || [],
    },
    {
        name: 'prev_result',
        label: 'previous result',
        make: ({previousTestResult}: SummarizeContext) =>
            previousTestResult.pipe(
                P.Option.map(_ =>
                    JSON.stringify(_.result, null, 2)?.split('\n'),
                ),
                P.Option.getOrElse<string[]>(() => []),
            ),
    },
    {
        name: 'prev_result_diff',
        label: 'diff previous result',
        make: ({testResult, previousTestResult}: SummarizeContext) =>
            previousTestResult.pipe(
                P.Option.map(
                    _ =>
                        formatDiff(diff(testResult.expected, _.result))?.split(
                            '\n',
                        ) || [],
                ),
                P.Option.getOrElse<string[]>(() => []),
            ),
    },
];

export const showSummary = ({
    testRun,
    displayConfig,
    previousTestRun = P.Option.none(),
    selectColumns = [
        'index',
        'hash',
        'timeMillis',
        'input',
        'tags',
        'label',
        'expected',
        'result_diff',
        'prev_result_diff',
    ],
}: {
    testRun: TestRunResults;
    previousTestRun?: P.Option.Option<TestRunResults>;
    displayConfig?: Partial<DisplayConfig> | undefined;
    selectColumns?: P.Array.NonEmptyArray<SummarizeColumnNames>;
}) => {
    const cfg = {...makeDefault(), ...displayConfig};

    const hashes = testRun.testCaseHashes;

    const _columns = columns
        .filter(c => selectColumns.includes(c.name))
        .filter(
            c =>
                c.name !== 'prev_result_diff' ||
                P.Option.isSome(previousTestRun),
        );
    let columnWidths = _columns.map(m => m.label.length);

    const rows = [];

    for (let i = 0; i < hashes.length; i++) {
        const hash = hashes[i];
        const testResult = testRun.testResultsByTestCaseHash[hash];
        const previousTestResult = previousTestRun.pipe(
            P.Option.flatMap(_ =>
                P.Record.get(_.testResultsByTestCaseHash, hash),
            ),
        );

        const row: [string, string[]][] = _columns.map(({label, make}) => [
            label,
            make({i, hashes: hashes, testResult, previousTestResult}),
        ]);

        columnWidths = columnWidths.map((w, i) =>
            Math.max(w, ...row[i][1].map(s => colors.unstyle(s).length)),
        );

        const maxHeight = row.reduce(
            (n, [key, values]) => Math.max(n, values.length),
            1,
        );

        row.forEach(([key, values], i) => {
            if (values.length < maxHeight) {
                values.push(...Array(maxHeight - values.length).fill(''));
            }
        });

        rows.push(row);
    }

    const header = showHeader(cfg, columnWidths, _columns);

    let s = '';
    s += showTitle(cfg, columnWidths, colors.bold('SUMMARY'));
    s += header;
    s += showBorder(cfg, columnWidths, 'middle');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // We can hard-code row[0], as all rows have the same height (aka sub-rows).
        // As a row is a tuple of [key, row,values], we can access the height by row[0][1].length
        const height = row[0][1].length;
        s += showRow(cfg, row, columnWidths, height);
        s += showBorder(cfg, columnWidths, 'middle');
    }

    s += header;
    s += showBorder(cfg, columnWidths, 'bottom');

    return s;
};
