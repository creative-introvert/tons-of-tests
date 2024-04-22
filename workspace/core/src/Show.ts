/* eslint-disable import/no-named-as-default-member */
import {isDeepStrictEqual} from 'node:util';

import colors from 'ansi-colors';
import {identity} from 'effect';
import {number} from 'effect/Equivalence';
import {sum} from 'effect/Number';

import * as P from './prelude.js';
import type * as Test from './Test.js';
import {defaultIsNil, type Label} from './Classify.js';

export type DisplayConfig = {
    /** @default true */
    colorize: boolean;
    /** @default ' │ ' */
    columnDelimiter: string;
    /** @default '-' */
    rowDelimiter: string;
    /** @default '=' */
    headerDelimiter: string;
    /** @default 2 */
    columnPadding: number;
};

export const DisplayConfig = {
    default: (): DisplayConfig => ({
        colorize: true,
        columnDelimiter: ' │ ',
        rowDelimiter: '-',
        headerDelimiter: '=',
        columnPadding: 2,
    }),
};

type Widths<K extends string> = Record<K, number>;

function getWidths<K extends string>({
    display,
    previousWidths,
    columns,
}: {
    display: Record<K, string>;
    previousWidths: Widths<K>;
    columns: readonly K[];
}): Widths<K> {
    return columns.reduce<Widths<K>>((widths, column) => {
        widths[column] = Math.max(
            // Name of column is the minimum length.
            column.length,
            widths[column],
            colors.unstyle(display[column]).length,
        );
        return widths;
    }, previousWidths);
}

function getTotalWidth<C extends string>({
    widths,
    displayConfig: cfg,
}: {
    widths: Widths<C>;
    displayConfig: DisplayConfig;
}): number {
    const all: number[] = Object.values(widths);
    return all.reduce(sum) + (all.length - 1) * cfg.columnDelimiter.length;
}

const columns = [
    'index',
    'id',
    'input',
    'tags',
    'label',
    'expected',
    'result',
    'previous result',
] as const;

type Columns = (typeof columns)[number];

type Rows<I, O, T> = {
    xs: {
        display: Record<Columns, string> & {
            hasPrevious: boolean;
            hasResultDiff: boolean;
        };
        testResult: Test._TestResult<I, O, T>;
        previousTestResult: P.O.Option<Test._TestResult<I, O, T>>;
    }[];
    widths: Widths<Columns>;
};

function createHeaders<K extends string>({
    columns,
    widths,
}: {
    columns: readonly K[];
    widths: Widths<K>;
}): string {
    return columns.map(column => column.padEnd(widths[column])).join(' | ');
}

function createHeadRow({
    value,
    totalWidth,
}: {
    value: string;
    totalWidth: number;
}): string {
    return value.padStart(
        Math.floor(totalWidth / 2) + Math.ceil(value.length / 2),
    );
}

const Rows = {
    empty: <I, O, T>(): Rows<I, O, T> => ({
        xs: [],
        widths: columns.reduce(
            (m, key) => ({...m, [key]: 0}),
            {} as Widths<Columns>,
        ),
    }),
};

type Colorizer = (s: string) => string;

export const colorLabel = (label: Label, isNew = false): Colorizer => {
    switch (label) {
        case 'TP':
            return isNew ? colors.blue : colors.green;
        case 'TN':
            return isNew ? colors.blue : colors.green;
        case 'FP':
            return isNew ? colors.yellow : colors.red;
        case 'FN':
            return isNew ? colors.yellow : colors.red;
    }
};

// positive = good
const colorPositive = (n: number): Colorizer =>
    n < 0 ? colors.red : n > 0 ? colors.green : colors.white;

// negative = good
const colorNegative = (n: number): Colorizer =>
    n > 0 ? colors.red : n < 0 ? colors.green : colors.white;

const colorIdentity = (): Colorizer => identity;

export const showID = (id: string): string => id.slice(0, 8);

export const showValue = <I>(value: I): string => JSON.stringify(value);

export const single = <I, O, T>({
    testResult,
}: {
    testResult: Test._TestResult<I, O, T>;
}): string => {
    const label = colorLabel(testResult.label, true)(testResult.label);
    const input = showValue(testResult.input);
    const expected = showValue(testResult.expected);
    const result = colorLabel(
        testResult.label,
        false,
    )(showValue(testResult.result));
    return `${label} :: ${input} -> ${result} (${expected})`;
};

export const summary = <I, O, T>({
    testRun,
    displayConfig,
    previousTestRun = P.O.none(),
    isResultNil = defaultIsNil,
    showInput = showValue,
    showExpected = showValue,
    showResult = showValue,
}: {
    testRun: Test._TestRun<I, O, T>;
    previousTestRun?: P.O.Option<Test._TestRun<I, O, T>>;
    displayConfig?: Partial<DisplayConfig> | undefined;
    isResultNil?: ((result: O) => boolean) | undefined;
    showInput?: ((input: I) => string) | undefined;
    showExpected?: ((expected: T) => string) | undefined;
    showResult?: ((result: O, expected: T) => string) | undefined;
}): string => {
    const cfg = {...DisplayConfig.default(), ...displayConfig};

    const _colorLabel = cfg.colorize ? colorLabel : colorIdentity;

    const ids = testRun.testResultIds;
    const rows = Rows.empty<I, O, T>();

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];

        const testResult = testRun.testResultsById[id];
        const previousTestResult = previousTestRun.pipe(
            P.O.map(m => m.testResultsById[id]),
        );
        const previousResultResult = P.O.map(previousTestResult, _ => _.result);

        const hasPrevious = P.O.isSome(previousTestResult);
        const hasResultDiff = isDeepStrictEqual(
            testResult.result,
            previousResultResult,
        );

        const display = {
            index: `${i + 1}/${ids.length}`,
            id: showID(id),
            input: showInput(testResult.input),
            tags: testResult.tags.join(','),
            label: testResult.label.toString(),
            expected: showExpected(testResult.expected),
            result: showResult(testResult.result, testResult.expected),
            'previous result': P.O.match(previousResultResult, {
                onNone: () => '∅',
                onSome: result => showResult(result, testResult.expected),
            }),
            hasPrevious,
            hasResultDiff,
        };

        rows.xs.push({
            display,
            testResult,
            previousTestResult,
        });

        rows.widths = getWidths({
            display,
            columns,
            previousWidths: rows.widths,
        });
    }

    const _headers = createHeaders({
        columns,
        widths: rows.widths,
    });

    const totalWidth = getTotalWidth({
        widths: rows.widths,
        displayConfig: cfg,
    });

    const headerDelimiter = cfg.headerDelimiter.repeat(totalWidth);
    const rowDelimiter = cfg.rowDelimiter.repeat(totalWidth);

    const _rows = rows.xs
        .map(({testResult, previousTestResult, display}, i, xs) => {
            const hasPreviousResult = P.O.map(
                previousTestResult,
                _ => _.result,
            ).pipe(P.O.isSome);

            const row: string[] = [
                colors.gray.italic(display.tags.padEnd(rows.widths.tags)),
                _colorLabel(
                    testResult.label,
                    !display.hasPrevious,
                )(display.label.padEnd(rows.widths.label)),
                display.expected.padEnd(rows.widths.expected),
                _colorLabel(
                    testResult.label,
                    !display.hasPrevious,
                )(display.result.padEnd(rows.widths.result)),
                previousTestResult.pipe(
                    P.O.match({
                        onNone: () => '∅',
                        onSome: ({label}) =>
                            _colorLabel(
                                label,
                                !display.hasPrevious,
                            )(
                                display['previous result'].padEnd(
                                    rows.widths['previous result'],
                                ),
                            ),
                    }),
                ),
            ];

            const prev = i > 0 ? xs[i - 1] : undefined;
            if (prev?.testResult.id !== testResult.id) {
                const result = [
                    display.index.padEnd(rows.widths.index),
                    display.id.padEnd(rows.widths.id),
                    display.input.padEnd(rows.widths.input),
                ]
                    .concat(row)
                    .join(cfg.columnDelimiter);
                return result;
            }
            // TODO: This only makes sense when we render multiple rows per result.
            //
            // We're on the same id as the previous row, so we don't
            // need to display the row headers again.
            else {
                const result = [
                    ''.padEnd(rows.widths.index),
                    ''.padEnd(rows.widths.id),
                    ''.padEnd(rows.widths.input),
                ]
                    .concat(row)
                    .join(cfg.columnDelimiter);
                return result;
            }
        })
        .join(`\n${rowDelimiter}\n`);

    return [
        headerDelimiter,
        createHeadRow({value: 'SUMMARY', totalWidth}),
        headerDelimiter,
        _headers,
        rowDelimiter,
        _rows,
        headerDelimiter,
        _headers,
        headerDelimiter,
    ].join('\n');
};

// export const legend = ({
//     displayConfig,
// }: {
//     displayConfig?: Partial<DisplayConfig>;
// }): string => {
//     const cfg = {...DisplayConfig.default(), ...displayConfig};
//     const xs = [
//         {
//             term: 'TP',
//             description: 'True Positive. Correctly predicted a result.',
//         },
//         {
//             term: 'TN',
//             description:
//                 'True Negative. Correctly predicted no result. I.o.w. expected no result, and got none.',
//         },
//         {
//             term: 'FP',
//             description: 'False Positive. Incorrectly predicted a result.',
//         },
//         {
//             term: 'FN',
//             description:
//                 'False Negative. Incorrectly predicted no result. I.o.w. expected no result, but got one.',
//         },
//         {
//             term: 'precision',
//             description: `The ratio of correctly predicted results (TP) to the total predicted positives (TP + FP). It answers the question: Out of all the true positives, how many are actually correct?`,
//         },
//         {
//             term: 'recall',
//             description: `The ratio of correctly identified positives (TP) to all the cases that are actually positive (TP + FN). It answers the question: Out of all the cases that are true positives, how many did we find?`,
//         },
//     ];
//     const maxTerm = xs.reduce((m, x) => Math.max(m, x.term.length), 0) + 2;
//     const maxDesc = xs.reduce((m, x) => Math.max(m, x.description.length), 0);
//     const rowDelimiter = cfg.headerDelimiter.repeat(maxTerm + maxDesc);
//
//     return [
//         rowDelimiter,
//         'LEGEND',
//         rowDelimiter,
//         ...xs.map(x => `${x.term}: `.padEnd(maxTerm) + x.description),
//         rowDelimiter,
//     ].join('\n');
// };
//
//
//
// // =============================================================================
// // Summary
// // =============================================================================
//
// export const noResults = ({
//     displayConfig,
// }: {
//     displayConfig?: Partial<DisplayConfig>;
// }): string => {
//     const cfg = {...DisplayConfig.default(), ...displayConfig};
//
//     return [
//         cfg.headerDelimiter.repeat(80),
//         'No results to display.',
//         cfg.headerDelimiter.repeat(80),
//     ].join('\n');
// };

// =============================================================================
// Stats
// =============================================================================

const statsColumns = ['TP', 'TN', 'FP', 'FN', 'precision', 'recall'] as const;

type StatsColumns = (typeof statsColumns)[number];

type StatsRows = {
    display: Record<StatsColumns, string>;
    widths: Widths<StatsColumns>;
};

const StatsRows = {
    empty: (): StatsRows => ({
        display: {} as Record<StatsColumns, string>,
        widths: statsColumns.reduce(
            (m, key) => ({...m, [key]: 0}),
            {} as Widths<StatsColumns>,
        ),
    }),
};

export const stats = <I, O, T>({
    testRun,
    displayConfig,
}: {
    testRun: Pick<Test._TestRun<I, O, T>, 'stats'>;
    displayConfig?: Partial<DisplayConfig>;
}): string => {
    const cfg = {...DisplayConfig.default(), ...displayConfig};
    const _colorPositive = cfg.colorize ? colorPositive : colorIdentity;
    const _colorNegative = cfg.colorize ? colorNegative : colorIdentity;

    const stats = testRun.stats;

    const display = {
        TP: stats.TP.toString(),
        TN: stats.TN.toString(),
        FP: stats.FP.toString(),
        FN: stats.FN.toString(),
        precision: stats.precision.toFixed(2),
        recall: stats.recall.toFixed(2),
    };
    const defaultWidths = StatsRows.empty().widths;

    const widths = getWidths({
        display,
        columns: statsColumns,
        previousWidths: defaultWidths,
    });

    const totalWidth = getTotalWidth({
        widths,
        displayConfig: cfg,
    });

    const headerDelimiter = cfg.headerDelimiter.repeat(totalWidth);
    const rowDelimiter = cfg.rowDelimiter.repeat(totalWidth);

    const _headers = createHeaders({
        columns: statsColumns,
        widths,
    });

    const _rows = [
        _colorPositive(stats.TP)(display.TP.padEnd(widths.TP)),
        _colorPositive(stats.TN)(display.TN.padEnd(widths.TN)),
        _colorNegative(stats.FP)(display.FP.padEnd(widths.FP)),
        _colorNegative(stats.FN)(display.FN.padEnd(widths.FN)),
        display.precision.padEnd(widths.precision),
        display.recall.padEnd(widths.recall),
    ].join(' | ');

    return [
        headerDelimiter,
        createHeadRow({value: 'STATS', totalWidth}),
        headerDelimiter,
        _headers,
        rowDelimiter,
        _rows,
        headerDelimiter,
    ].join('\n');
};

// =============================================================================
// Diff
// =============================================================================

const diffColumns = ['TP', 'TN', 'FP', 'FN', 'precision', 'recall'] as const;

type DiffColumns = (typeof diffColumns)[number];

type DiffRows = {
    display: Record<DiffColumns, string>;
    values: Test.Diff;
    widths: Widths<DiffColumns>;
};

export const diff = <I, O, T>({
    testRun,
    diff,
    config: _config,
}: {
    testRun: Test._TestRun<I, O, T>;
    diff: Test.Diff;
    config?: Partial<DisplayConfig>;
}): string => {
    const config = {...DisplayConfig.default(), ..._config};
    const _colorPositive = config.colorize ? colorPositive : colorIdentity;
    const _colorNegative = config.colorize ? colorNegative : colorIdentity;

    const display = {
        TP: diff.TP.toString(),
        TN: diff.TN.toString(),
        FP: diff.FP.toString(),
        FN: diff.FN.toString(),
        precision: diff.precision.toFixed(2),
        recall: diff.recall.toFixed(2),
    };

    const defaultWidths = StatsRows.empty().widths;

    const widths = getWidths({
        display,
        columns: diffColumns,
        previousWidths: defaultWidths,
    });

    const totalWidth = getTotalWidth({
        widths,
        displayConfig: config,
    });

    const headerDelimiter = config.headerDelimiter.repeat(totalWidth);
    const rowDelimiter = config.rowDelimiter.repeat(totalWidth);
    const _headers = createHeaders({columns: diffColumns, widths});

    const _rows = [
        _colorPositive(diff.TP)(display.TP.padEnd(widths.TP)),
        _colorPositive(diff.TN)(display.TN.padEnd(widths.TN)),
        _colorNegative(diff.FP)(display.FP.padEnd(widths.FP)),
        _colorNegative(diff.FN)(display.FN.padEnd(widths.FN)),
        _colorPositive(diff.precision)(
            display.precision.padEnd(widths.precision),
        ),
        _colorPositive(diff.recall)(display.recall.padEnd(widths.recall)),
    ].join(config.columnDelimiter);

    return [
        headerDelimiter,
        createHeadRow({value: 'DIFF', totalWidth}),
        headerDelimiter,
        _headers,
        rowDelimiter,
        _rows,
        headerDelimiter,
    ].join('\n');
};
