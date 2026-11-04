import colors from 'ansi-colors';

import type {DisplayConfig} from '../DisplayConfig.js';
import type {DiffColumn, DiffColumnNames} from '../Show.js';
import type {Diff} from '../Test.js';
import {count} from './Classify.js';
import {
    colorPositive,
    showBorder,
    showHeader,
    showRow,
    showTitle,
} from './common.js';
import {
    countHeader,
    countLabels,
    makeDefault,
    showCountDiff,
} from './DisplayConfig.js';

export const showDiff = ({
    diff,
    displayConfig,
    selectColumns,
}: {
    diff: Diff;
    displayConfig?: Partial<DisplayConfig> | undefined;
    selectColumns?: DiffColumnNames[];
}): string => {
    const cfg = {...makeDefault(), ...displayConfig};
    const selected: DiffColumnNames[] = selectColumns ?? [
        ...countLabels([diff.counts]).map(
            (label): DiffColumnNames => `count:${label}`,
        ),
        'precision',
        'recall',
    ];
    const metrics = selected.filter(
        name => name === 'precision' || name === 'recall',
    );
    const columns: DiffColumn[] = selected.map(name => {
        if (name === 'precision' || name === 'recall') {
            return {
                name,
                label: name,
                make: ({diff}) => [
                    colorPositive(diff[name])(diff[name].toFixed(2)),
                ],
            };
        }
        const label = name.slice(6);
        return {
            name,
            label: countHeader(label, metrics),
            make: ({diff}) => [
                showCountDiff(cfg, label, count(diff.counts, label)),
            ],
        };
    });
    if (columns.length === 0) return '';
    const row: [string, string[]][] = columns.map(({label, make}) => [
        label,
        make({diff}),
    ]);
    const widths = columns.map((column, i) =>
        Math.max(column.label.length, colors.unstyle(row[i][1][0]).length),
    );
    const header = showHeader(cfg, widths, columns);
    return (
        showTitle(cfg, widths, colors.bold('DIFF')) +
        header +
        showBorder(cfg, widths, 'middle') +
        showRow(cfg, row, widths, 1) +
        showBorder(cfg, widths, 'middle') +
        header +
        showBorder(cfg, widths, 'bottom')
    );
};
