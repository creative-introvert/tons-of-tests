import colors from 'ansi-colors';

import type {DisplayConfig} from '../DisplayConfig.js';
import {
    colorNegative,
    colorPositive,
    showBorder,
    showHeader,
    showRow,
    showTitle,
} from './common.js';
import type {TestRun} from './Test.js';
import {makeDefault} from './DisplayConfig.js';
import type {StatsColumn, StatsColumnNames, StatsContext} from '../Show.js';

const columns: StatsColumn[] = [
    {
        name: 'TP',
        label: 'TP',
        make: ({stats}: StatsContext) => [
            colorPositive(stats.TP)(stats.TP.toString()),
        ],
    },
    {
        name: 'TN',
        label: 'TN',
        make: ({stats}: StatsContext) => [
            colorPositive(stats.TN)(stats.TN.toString()),
        ],
    },
    {
        name: 'FP',
        label: 'FP',
        make: ({stats}: StatsContext) => [
            colorNegative(stats.FP)(stats.FP.toString()),
        ],
    },
    {
        name: 'FN',
        label: 'FN',
        make: ({stats}: StatsContext) => [
            colorNegative(stats.FN)(stats.FN.toString()),
        ],
    },
    {
        name: 'precision',
        label: 'precision',
        make: ({stats}: StatsContext) => [stats.precision.toFixed(2)],
    },
    {
        name: 'recall',
        label: 'recall',
        make: ({stats}: StatsContext) => [stats.recall.toFixed(2)],
    },
];

export const stats = <I, O, T>({
    testRun,
    displayConfig,
    selectColumns = ['TP', 'TN', 'FP', 'FN', 'precision', 'recall'],
}: {
    testRun: Pick<TestRun<I, O, T>, 'stats'>;
    displayConfig?: Partial<DisplayConfig>;
    selectColumns?: StatsColumnNames[];
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};

    const _columns = columns.filter(c => selectColumns.includes(c.name));

    const row: [string, string[]][] = _columns.map(({label, make}) => [
        label,
        make({stats: testRun.stats}),
    ]);

    const columnWidths = _columns.map((m, i) =>
        Math.max(
            m.label.length,
            ...row[i][1].map(s => colors.unstyle(s).length),
        ),
    );

    const header = showHeader(cfg, columnWidths, _columns);
    let s = '';
    s += showTitle(cfg, columnWidths, colors.bold('STATS'));
    s += header;
    s += showBorder(cfg, columnWidths, 'middle');

    const height = row[0][1].length;
    s += showRow(cfg, row, columnWidths, height);

    s += showBorder(cfg, columnWidths, 'middle');

    s += header;
    s += showBorder(cfg, columnWidths, 'bottom');

    return s;
};
