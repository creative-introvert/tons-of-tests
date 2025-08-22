import colors from 'ansi-colors';

import type {DisplayConfig} from '../DisplayConfig.js';
import type {DiffColumn, DiffColumnNames, DiffContext} from '../Show.js';
import type {Diff} from '../Test.js';
import {
    colorNegative,
    colorPositive,
    showBorder,
    showHeader,
    showRow,
    showTitle,
} from './common.js';
import {makeDefault} from './DisplayConfig.js';

const columns: DiffColumn[] = [
    {
        name: 'TP',
        label: 'TP',
        make: ({diff}: DiffContext) => [
            colorPositive(diff.TP)(diff.TP.toString()),
        ],
    },
    {
        name: 'TN',
        label: 'TN',
        make: ({diff}: DiffContext) => [
            colorPositive(diff.TN)(diff.TN.toString()),
        ],
    },
    {
        name: 'FP',
        label: 'FP',
        make: ({diff}: DiffContext) => [
            colorNegative(diff.FP)(diff.FP.toString()),
        ],
    },
    {
        name: 'FN',
        label: 'FN',
        make: ({diff}: DiffContext) => [
            colorNegative(diff.FN)(diff.FN.toString()),
        ],
    },
    {
        name: 'precision',
        label: 'precision',
        make: ({diff}: DiffContext) => [
            colorPositive(diff.precision)(diff.precision.toFixed(2)),
        ],
    },
    {
        name: 'recall',
        label: 'recall',
        make: ({diff}: DiffContext) => [
            colorPositive(diff.recall)(diff.recall.toFixed(2)),
        ],
    },
];

export const showDiff = ({
    diff,
    displayConfig,
    selectColumns = ['TP', 'TN', 'FP', 'FN', 'precision', 'recall'],
}: {
    diff: Diff;
    displayConfig?: Partial<DisplayConfig>;
    selectColumns?: DiffColumnNames[];
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};
    const _columns = columns.filter(c => selectColumns.includes(c.name));

    const _display = {
        precision: diff.precision.toFixed(2),
        recall: diff.recall.toFixed(2),
    };

    const row: [string, string[]][] = _columns.map(({label, make}) => [
        label,
        make({diff}),
    ]);

    const columnWidths = _columns.map((m, i) =>
        Math.max(
            m.label.length,
            ...row[i][1].map(s => colors.unstyle(s).length),
        ),
    );

    const header = showHeader(cfg, columnWidths, _columns);
    let s = '';
    s += showTitle(cfg, columnWidths, colors.bold('DIFF'));
    s += header;
    s += showBorder(cfg, columnWidths, 'middle');

    const height = row[0][1].length;
    s += showRow(cfg, row, columnWidths, height);
    s += showBorder(cfg, columnWidths, 'middle');

    s += header;
    s += showBorder(cfg, columnWidths, 'bottom');

    return s;
};
