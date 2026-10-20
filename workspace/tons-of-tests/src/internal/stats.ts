import colors from 'ansi-colors';
import {Option} from 'effect';

import type {Stats} from '../Classify.js';
import type {DisplayConfig} from '../DisplayConfig.js';
import type {StatsColumn, StatsColumnNames, StatsContext} from '../Show.js';
import type {TestRunResults} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {
    colorNegative,
    colorPositive,
    showBorder,
    showHeader,
    showRow,
    showTitle,
} from './common.js';
import {makeDefault} from './DisplayConfig.js';

const columns: StatsColumn[] = [
    {
        name: 'testCases',
        label: 'cases',
        make: ({stats}: StatsContext) => [stats.testCases.toString()],
    },
    {
        name: 'total',
        label: 'results',
        make: ({stats}: StatsContext) => [stats.total.toString()],
    },
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
    {
        name: 'timeMin',
        label: 'timeMin',
        make: ({stats}: StatsContext) => [
            stats.timeMin.pipe(
                Option.match({
                    onSome: n => `${n.toFixed(2)}ms`,
                    onNone: () => '-',
                }),
            ),
        ],
    },
    {
        name: 'timeMax',
        label: 'timeMax',
        make: ({stats}: StatsContext) => [
            stats.timeMax.pipe(
                Option.match({
                    onSome: n => `${n.toFixed(2)}ms`,
                    onNone: () => '-',
                }),
            ),
        ],
    },
    {
        name: 'timeMean',
        label: 'timeMean',
        make: ({stats}: StatsContext) => [
            stats.timeMean.pipe(
                Option.match({
                    onSome: n => `${n.toFixed(2)}ms`,
                    onNone: () => '-',
                }),
            ),
        ],
    },
    {
        name: 'timeMedian',
        label: 'timeMedian',
        make: ({stats}: StatsContext) => [
            stats.timeMedian.pipe(
                Option.match({
                    onSome: n => `${n.toFixed(2)}ms`,
                    onNone: () => '-',
                }),
            ),
        ],
    },
];

export const showStats = <I, O, T>({
    testRun,
    displayConfig,
    selectColumns = [
        'testCases',
        'total',
        'TP',
        'TN',
        'FP',
        'FN',
        'precision',
        'recall',
        'timeMean',
        'timeMedian',
    ],
}: {
    testRun: Pick<TestRunResults<I, O, T>, 'stats'>;
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

/** Missing baselines have no metrics; completed empty runs have zero counts. */
export const showRunSummaries = ({
    summaries,
    displayConfig,
}: {
    summaries: ReadonlyArray<{
        name: string;
        variant: string;
        run: Option.Option<TestRun>;
        stats: Option.Option<Stats>;
        retired: boolean;
    }>;
    displayConfig?: Partial<DisplayConfig> | undefined;
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};
    const labels = [
        'suite',
        'variant',
        'run',
        'status',
        'cases',
        'results',
        'precision',
        'recall',
        'mean time',
    ];
    const rows = summaries.map(summary => {
        const stats = Option.getOrUndefined(summary.stats);
        const fields = [
            summary.name,
            summary.variant,
            Option.match(summary.run, {
                onNone: () => '-',
                onSome: run => `run:${run.id}`,
            }),
            [
                ...(summary.retired ? ['retired'] : []),
                ...(Option.isNone(summary.run) ? ['no baseline'] : []),
            ].join(', '),
            stats === undefined ? '-' : String(stats.testCases),
            stats === undefined ? '-' : String(stats.total),
            stats === undefined ? '-' : stats.precision.toFixed(2),
            stats === undefined ? '-' : stats.recall.toFixed(2),
            stats === undefined
                ? '-'
                : Option.match(stats.timeMean, {
                      onNone: () => '-',
                      onSome: time => `${time.toFixed(2)}ms`,
                  }),
        ];
        return fields.map((field, index): [string, string[]] => [
            labels[index],
            [field],
        ]);
    });
    const widths = labels.map((label, index) =>
        rows.reduce(
            (width, row) =>
                Math.max(width, colors.unstyle(row[index][1][0]).length),
            label.length,
        ),
    );
    const header = showHeader(
        cfg,
        widths,
        labels.map(label => ({label})),
    );
    return (
        showTitle(cfg, widths, colors.bold('RUN STATISTICS')) +
        header +
        showBorder(cfg, widths, 'middle') +
        rows.map(row => showRow(cfg, row, widths, 1)).join('') +
        showBorder(cfg, widths, 'bottom')
    );
};
