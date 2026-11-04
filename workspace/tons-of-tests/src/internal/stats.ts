import colors from 'ansi-colors';
import {Option} from 'effect';

import type {Stats} from '../Classify.js';
import type {DisplayConfig} from '../DisplayConfig.js';
import type {StatsColumn, StatsColumnNames, StatsContext} from '../Show.js';
import type {TestRunResults} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {showBorder, showHeader, showRow, showTitle} from './common.js';
import {count} from './Classify.js';
import {
    countHeader,
    countLabels,
    makeDefault,
    showCount,
} from './DisplayConfig.js';

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
    previousStats,
    displayConfig,
    selectColumns,
}: {
    testRun: Pick<TestRunResults<I, O, T>, 'stats'>;
    /** Include labels from the other side of a comparison, showing absent counts as zero. */
    previousStats?: Stats | undefined;
    displayConfig?: Partial<DisplayConfig> | undefined;
    selectColumns?: StatsColumnNames[];
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};

    const selected: StatsColumnNames[] = selectColumns ?? [
        'testCases',
        'total',
        ...countLabels([
            testRun.stats.counts,
            ...(previousStats === undefined ? [] : [previousStats.counts]),
        ]).map((label): StatsColumnNames => `count:${label}`),
        'precision',
        'recall',
        'timeMean',
        'timeMedian',
    ];
    const metricHeaders = columns
        .filter(column => selected.includes(column.name))
        .map(column => column.label);
    const _columns = selected.flatMap((name): StatsColumn[] => {
        if (name.startsWith('count:')) {
            const label = name.slice(6);
            return [
                {
                    name,
                    label: countHeader(label, metricHeaders),
                    make: ({stats}) => [
                        showCount(cfg, label, count(stats.counts, label)),
                    ],
                },
            ];
        }
        return columns.filter(column => column.name === name);
    });
    if (_columns.length === 0) return '';

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
        source: 'fresh' | 'cache' | 'snapshot';
    }>;
    displayConfig?: Partial<DisplayConfig> | undefined;
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};
    const categories = countLabels(
        summaries.flatMap(summary =>
            Option.isSome(summary.stats) ? [summary.stats.value.counts] : [],
        ),
    );
    const metricHeaders = [
        'suite',
        'variant',
        'run',
        'source',
        'status',
        'cases',
        'results',
        'precision',
        'recall',
        'mean time',
    ];
    const labels = [
        'suite',
        'variant',
        'run',
        'source',
        'status',
        'cases',
        'results',
        ...categories.map(label => countHeader(label, metricHeaders)),
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
                onSome: run =>
                    run.store === 'snapshot' ? `run:${run.id}` : '-',
            }),
            summary.source,
            [
                ...(summary.retired ? ['retired'] : []),
                ...(Option.isNone(summary.run) ? ['no baseline'] : []),
            ].join(', '),
            stats === undefined ? '-' : String(stats.testCases),
            stats === undefined ? '-' : String(stats.total),
            ...categories.map(label =>
                stats === undefined
                    ? '-'
                    : showCount(cfg, label, count(stats.counts, label)),
            ),
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
