import colors from 'ansi-colors';
import * as jdp from 'jsondiffpatch';

import * as P from '../prelude.js';
import {formatDiff} from './format-diff.js';
import type {DisplayConfig} from '../DisplayConfig.js';
import {showBorder, showHeader, showRow, showTitle} from './common.js';
import type {TestRun as _TestRun} from '../Test.js';
import {makeDefault} from './DisplayConfig.js';
import type {
    SummarizeColumn,
    SummarizeColumnNames,
    SummarizeContext,
} from '../Show.js';

const columns: SummarizeColumn[] = [
    {
        name: 'index',
        label: '#',
        make: ({i, ids}: SummarizeContext) => [`${i + 1}/${ids.length}`],
    },
    {
        name: 'hash',
        label: 'hash',
        make: ({i, ids}: SummarizeContext) => [ids[i].slice(0, 8)],
    },
    {
        name: 'input',
        label: 'input',
        make: ({i, ids, testRun}: SummarizeContext) =>
            JSON.stringify(
                testRun.testResultsById[ids[i]].input,
                null,
                2,
            ).split('\n'),
    },
    {
        name: 'tags',
        label: 'tags',
        make: ({i, ids, testRun}: SummarizeContext) =>
            testRun.testResultsById[ids[i]].tags as string[],
    },
    {
        name: 'label',
        label: 'lbl',
        make: ({i, ids, testRun, previousTestRun}: SummarizeContext) => {
            const hasPrevious = previousTestRun.pipe(
                P.O.map(_ => _.testResultsById[ids[i]].result),
                P.O.isSome,
            );
            const label = testRun.testResultsById[ids[i]].label;
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
        make: ({i, ids, testRun}: SummarizeContext) =>
            JSON.stringify(
                testRun.testResultsById[ids[i]].expected,
                null,
                2,
            ).split('\n'),
    },
    {
        name: 'result',
        label: 'result',
        make: ({i, ids, testRun}: SummarizeContext) =>
            JSON.stringify(
                testRun.testResultsById[ids[i]].result,
                null,
                2,
            ).split('\n'),
    },
    {
        name: 'result_diff',
        label: 'diff result',
        make: ({i, ids, testRun}: SummarizeContext) =>
            formatDiff(
                jdp.diff(
                    testRun.testResultsById[ids[i]].expected,
                    testRun.testResultsById[ids[i]].result,
                ),
            )?.split('\n') || [],
    },
    {
        name: 'prev_result',
        label: 'previous result',
        make: ({i, ids, testRun, previousTestRun}: SummarizeContext) =>
            previousTestRun.pipe(
                P.O.map(_ =>
                    JSON.stringify(
                        _.testResultsById[ids[i]].result,
                        null,
                        2,
                    )?.split('\n'),
                ),
                P.O.getOrElse<string[]>(() => []),
            ),
    },
    {
        name: 'prev_result_diff',
        label: 'diff previous result',
        make: ({i, ids, testRun, previousTestRun}: SummarizeContext) =>
            previousTestRun.pipe(
                P.O.map(
                    _ =>
                        formatDiff(
                            jdp.diff(
                                testRun.testResultsById[ids[i]].expected,
                                _.testResultsById[ids[i]].result,
                            ),
                        )?.split('\n') || [],
                ),
                P.O.getOrElse<string[]>(() => []),
            ),
    },
];

export const summarize = <I, O, T>({
    testRun,
    displayConfig,
    previousTestRun = P.O.none(),
    selectColumns = [
        'index',
        'hash',
        'input',
        'tags',
        'label',
        'expected',
        'result_diff',
        'prev_result_diff',
    ],
}: {
    testRun: _TestRun<I, O, T>;
    previousTestRun?: P.O.Option<_TestRun<I, O, T>>;
    displayConfig?: Partial<DisplayConfig> | undefined;
    selectColumns?: SummarizeColumnNames[];
}) => {
    const cfg = {...makeDefault(), ...displayConfig};

    const ids = testRun.testResultIds;

    const _columns = columns.filter(c => selectColumns.includes(c.name));
    let columnWidths = _columns.map(m => m.label.length);

    const rows = [];

    for (let i = 0; i < ids.length; i++) {
        const row: [string, string[]][] = _columns.map(({label, make}) => [
            label,
            make({i, ids, testRun, previousTestRun}),
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
        const height = row[i][1].length;
        s += showRow(cfg, row, columnWidths, height);
        s += showBorder(cfg, columnWidths, 'middle');
    }

    s += header;
    s += showBorder(cfg, columnWidths, 'bottom');

    return s;
};
