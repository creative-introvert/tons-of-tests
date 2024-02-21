/* eslint-disable import/no-named-as-default-member */
import {isDeepStrictEqual} from 'node:util';

import colors from 'ansi-colors';

import * as P from './prelude.js';
import type * as Test from './Test.js';
import type {Label} from './Classification.js';

// =============================================================================
// Color
// =============================================================================

// const colorNothing =
//     () =>
//     <T>(a: T): T =>
//         a;
//
// // positive = good
// const colorPositive = (n: number): colors.StyleFunction =>
//     n < 0 ? colors.red : n > 0 ? colors.green : colors.white;
//
// // negative = good
// const colorNegative = (n: number): colors.StyleFunction =>
//     n > 0 ? colors.red : n < 0 ? colors.green : colors.white;
//
// export const colorLabel = (
//     label: Label,
//     isNew = false,
// ): colors.StyleFunction => {
//     switch (label) {
//         case 'TP':
//             return isNew ? colors.blue : colors.green;
//         case 'TN':
//             return isNew ? colors.blue : colors.green;
//         case 'FP':
//             return isNew ? colors.yellow : colors.red;
//         case 'FN':
//             return isNew ? colors.yellow : colors.red;
//     }
// };
//
// // =============================================================================
// // Display
// // =============================================================================
//
// export const DisplayConfig = {
//     default: (): DisplayConfig => ({
//         colorize: true,
//         columnDelimiter: ' │ ',
//         rowDelimiter: '-',
//         headerDelimiter: '=',
//         columnPadding: 2,
//     }),
// };
//
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
// export const hash = (s: string): string => s.slice(0, 8);
//
// export const value = (maybeValue: P.O.Option<Test.Json>): string => {
//     return P.O.match(maybeValue, {
//         onNone: () => '∅',
//         onSome: value => {
//             if (typeof value === 'string') {
//                 return `"${value}"`;
//             }
//             if (value === null) {
//                 return 'null';
//             }
//             if (typeof value === 'object') {
//                 return JSON.stringify(value);
//             }
//             return value.toString();
//         },
//     });
// };
//
// // =============================================================================
// // Summary
// // =============================================================================
//
// const columns = [
//     'index',
//     'id',
//     'input',
//     'tags',
//     'label',
//     'expected',
//     'result',
//     'previous result',
// ] as const;
// type Columns = (typeof columns)[number];
//
// type Rows<I extends Json, O extends P.O.Option<Json>> = {
//     xs: {
//         display: Record<Columns, string> & {
//             hasPrevious: boolean;
//             hasResultDiff: boolean;
//         };
//         testResult: Test.TestResult<I, O>;
//         previousTestResult: P.O.Option<Test.TestResult<I, O>>;
//     }[];
//     widths: Widths<Columns>;
// };
//
// const Rows = {
//     empty: <I extends Json, O extends P.O.Option<Json>>(): Rows<I, O> => ({
//         xs: [],
//         widths: columns.reduce(
//             (m, key) => ({...m, [key]: 0}),
//             {} as Widths<Columns>,
//         ),
//     }),
// };
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
//
// export const summary = <I extends Json, O extends P.O.Option<Json>>({
//     testRun,
//     previousTestRun,
//     displayConfig,
// }: {
//     testRun: Test.TestRun<I, O>;
//     previousTestRun: P.O.Option<Test.TestRun<I, O>>;
//     displayConfig?: Partial<DisplayConfig>;
// }): string => {
//     const cfg = {...DisplayConfig.default(), ...displayConfig};
//
//     const _colorLabel = cfg.colorize ? colorLabel : colorNothing;
//
//     const ids = testRun.testResultIds;
//
//     const rows = Rows.empty();
//
//     for (let i = 0; i < ids.length; i++) {
//         const id = ids[i];
//
//         const testResult = testRun.testResultsById[id];
//         const previousTestResult = previousTestRun.pipe(
//             P.O.map(m => m.testResultsById[id]),
//         );
//         const previousResultOutput = P.O.flatMap(
//             previousTestResult,
//             _ => _.output,
//         );
//
//         const hasPrevious = P.O.isSome(previousTestResult);
//         const hasResultDiff = isDeepStrictEqual(
//             testResult.output,
//             previousResultOutput,
//         );
//
//         const display = {
//             index: `${i + 1}/${ids.length}`,
//             id: hash(id),
//             input: value(P.O.some(testResult.input)),
//             tags: testResult.tags.pipe(
//                 P.O.map(xs => xs.join(',')),
//                 P.O.getOrElse(() => ''),
//             ),
//             label: testResult.classifiedAs.toString(),
//             expected: value(testResult.expected),
//             result: value(testResult.output),
//             'previous result': value(previousResultOutput),
//             hasPrevious,
//             hasResultDiff,
//         };
//
//         rows.xs.push({
//             display,
//             testResult,
//             previousTestResult,
//         });
//
//         rows.widths = getWidths({
//             display,
//             columns,
//             previousWidths: rows.widths,
//         });
//     }
//
//     const _headers = createHeaders({
//         columns,
//         widths: rows.widths,
//     });
//
//     const totalWidth = getTotalWidth({
//         widths: rows.widths,
//         displayConfig: cfg,
//     });
//
//     const headerDelimiter = cfg.headerDelimiter.repeat(totalWidth);
//     const rowDelimiter = cfg.rowDelimiter.repeat(totalWidth);
//
//     const _rows = rows.xs
//         .map(({testResult, previousTestResult, display}, i, xs) => {
//             const hasPreviousOutput = P.O.flatMap(
//                 previousTestResult,
//                 _ => _.output,
//             ).pipe(P.O.isSome);
//
//             const row: string[] = [
//                 colors.gray.italic(display.tags.padEnd(rows.widths.tags)),
//                 _colorLabel(
//                     testResult.classifiedAs,
//                     !display.hasPrevious,
//                 )(display.label.padEnd(rows.widths.label)),
//                 display.expected.padEnd(rows.widths.expected),
//                 _colorLabel(
//                     testResult.classifiedAs,
//                     !display.hasPrevious,
//                 )(display.result.padEnd(rows.widths.result)),
//                 previousTestResult.pipe(
//                     P.O.match({
//                         onNone: () => value(P.O.none()),
//                         onSome: ({output, classifiedAs}) =>
//                             P.O.match(output, {
//                                 onNone: () => value(P.O.none()),
//                                 onSome: () =>
//                                     _colorLabel(
//                                         classifiedAs,
//                                         !display.hasPrevious,
//                                     )(
//                                         display['previous result'].padEnd(
//                                             rows.widths['previous result'],
//                                         ),
//                                     ),
//                             }),
//                     }),
//                 ),
//             ];
//
//             const prev = i > 0 ? xs[i - 1] : undefined;
//             if (prev?.testResult.id !== testResult.id) {
//                 const result = [
//                     display.index.padEnd(rows.widths.index),
//                     display.id.padEnd(rows.widths.id),
//                     display.input.padEnd(rows.widths.input),
//                 ]
//                     .concat(row)
//                     .join(cfg.columnDelimiter);
//                 return result;
//             }
//             // We're on the same id as the previous row, so we don't
//             // need to display the row headers again.
//             else {
//                 const result = [
//                     ''.padEnd(rows.widths.index),
//                     ''.padEnd(rows.widths.id),
//                     ''.padEnd(rows.widths.input),
//                 ]
//                     .concat(row)
//                     .join(cfg.columnDelimiter);
//                 return result;
//             }
//         })
//         .join(`\n${rowDelimiter}\n`);
//
//     return [
//         headerDelimiter,
//         createHeadRow({value: 'SUMMARY', totalWidth}),
//         headerDelimiter,
//         _headers,
//         rowDelimiter,
//         _rows,
//         headerDelimiter,
//         _headers,
//         headerDelimiter,
//     ].join('\n');
// };
//
// // =============================================================================
// // Stats
// // =============================================================================
//
// const statsColumns = ['TP', 'TN', 'FP', 'FN', 'precision', 'recall'] as const;
//
// type StatsColumns = (typeof statsColumns)[number];
//
// type StatsRows = {
//     display: Record<StatsColumns, string>;
//     widths: Widths<StatsColumns>;
// };
//
// const StatsRows = {
//     empty: (): StatsRows => ({
//         display: {} as Record<StatsColumns, string>,
//         widths: statsColumns.reduce(
//             (m, key) => ({...m, [key]: 0}),
//             {} as Widths<StatsColumns>,
//         ),
//     }),
// };
//
// export const stats = <I extends Json, O extends P.O.Option<Json>>({
//     testRun,
//     displayConfig,
// }: {
//     testRun: Pick<Test.TestRun<I, O>, 'stats'>;
//     displayConfig?: Partial<DisplayConfig>;
// }): string => {
//     const cfg = {...DisplayConfig.default(), ...displayConfig};
//     const _colorPositive = cfg.colorize ? colorPositive : colorNothing;
//     const _colorNegative = cfg.colorize ? colorNegative : colorNothing;
//
//     const stats = testRun.stats;
//
//     const display = {
//         TP: stats.TP.toString(),
//         TN: stats.TN.toString(),
//         FP: stats.FP.toString(),
//         FN: stats.FN.toString(),
//         precision: stats.precision.toFixed(2),
//         recall: stats.recall.toFixed(2),
//     };
//     const defaultWidths = StatsRows.empty().widths;
//
//     const widths = getWidths({
//         display,
//         columns: statsColumns,
//         previousWidths: defaultWidths,
//     });
//
//     const totalWidth = getTotalWidth({
//         widths,
//         displayConfig: cfg,
//     });
//
//     const headerDelimiter = cfg.headerDelimiter.repeat(totalWidth);
//     const rowDelimiter = cfg.rowDelimiter.repeat(totalWidth);
//
//     const _headers = createHeaders({
//         columns: statsColumns,
//         widths,
//     });
//
//     const _rows = [
//         rows.display[feature].feature.padEnd(rows.widths.feature),
//         _colorPositive(stats.TP)(
//             rows.display[feature].TP.padEnd(rows.widths.TP),
//         ),
//         _colorPositive(stats.TN)(
//             rows.display[feature].TN.padEnd(rows.widths.TN),
//         ),
//         _colorNegative(stats.FP)(
//             rows.display[feature].FP.padEnd(rows.widths.FP),
//         ),
//         _colorNegative(stats.FN)(
//             rows.display[feature].FN.padEnd(rows.widths.FN),
//         ),
//         rows.display[feature].precision.padEnd(rows.widths.precision),
//         rows.display[feature].recall.padEnd(rows.widths.recall),
//     ].join(' | ');
//
//     return [
//         headerDelimiter,
//         createHeadRow({value: 'STATS', totalWidth}),
//         headerDelimiter,
//         _headers,
//         rowDelimiter,
//         _rows,
//         headerDelimiter,
//     ].join('\n');
// };
//
// // =============================================================================
// // Diff
// // =============================================================================
//
// const diffColumns = [
//     'feature',
//     'TP',
//     'TN',
//     'FP',
//     'FN',
//     'precision',
//     'recall',
// ] as const;
//
// type DiffColumns = (typeof diffColumns)[number];
//
// type DiffRows<K extends Test.Feature> = {
//     xs: Record<
//         K,
//         {
//             display: Record<DiffColumns, string>;
//             values: Test.Diff<K>;
//         }
//     >;
//     widths: Widths<DiffColumns>;
// };
//
// const DiffRows = {
//     empty: <K extends Test.Feature>(features: readonly K[]): DiffRows<K> => ({
//         xs: features.reduce(
//             (m, feature) => ({...m, [feature]: {}}),
//             {} as Record<
//                 K,
//                 {
//                     display: Record<DiffColumns, string>;
//                     values: Test.Diff<K>;
//                 }
//             >,
//         ),
//         widths: diffColumns.reduce(
//             (m, key) => ({...m, [key]: 0}),
//             {} as Widths<DiffColumns>,
//         ),
//     }),
// };
//
// export const diff = <I extends Json, O extends P.O.Option<Json>>({
//     testRun,
//     diffed,
//     displayConfig,
// }: {
//     testRun: Test.TestRun<I, O>;
//     diffed: Test.Diff[];
//     displayConfig?: Partial<DisplayConfig>;
// }): string => {
//     const cfg = {...DisplayConfig.default(), ...displayConfig};
//     const _colorPositive = cfg.colorize ? colorPositive : colorNothing;
//     const _colorNegative = cfg.colorize ? colorNegative : colorNothing;
//     const features = testRun.features;
//
//     const rows = diffed.reduce((m, next) => {
//         const display = {
//             feature: next.feature,
//             TP: next.TP.toString(),
//             TN: next.TN.toString(),
//             FP: next.FP.toString(),
//             FN: next.FN.toString(),
//             precision: next.precision.toFixed(2),
//             recall: next.recall.toFixed(2),
//         };
//         m.xs[next.feature].display = display;
//         m.xs[next.feature].values = next;
//
//         m.widths = getWidths({
//             display,
//             columns: diffColumns,
//             previousWidths: m.widths,
//         });
//
//         return m;
//     }, DiffRows.empty(features));
//
//     const totalWidth = getTotalWidth({
//         widths: rows.widths,
//         displayConfig: cfg,
//     });
//
//     const headerDelimiter = cfg.headerDelimiter.repeat(totalWidth);
//     const rowDelimiter = cfg.rowDelimiter.repeat(totalWidth);
//
//     const _headers = createHeaders({columns: diffColumns, widths: rows.widths});
//
//     const _rows = features
//         .map(feature => {
//             const values = rows.xs[feature].values;
//             const display = rows.xs[feature].display;
//             const widths = rows.widths;
//
//             return [
//                 display.feature.padEnd(rows.widths.feature),
//                 _colorPositive(values.TP)(display.TP.padEnd(widths.TP)),
//                 _colorPositive(values.TN)(display.TN.padEnd(widths.TN)),
//                 _colorNegative(values.FP)(display.FP.padEnd(widths.FP)),
//                 _colorNegative(values.FN)(display.FN.padEnd(widths.FN)),
//                 _colorPositive(values.precision)(
//                     display.precision.padEnd(widths.precision),
//                 ),
//                 _colorPositive(values.recall)(
//                     display.recall.padEnd(widths.recall),
//                 ),
//             ].join(cfg.columnDelimiter);
//         })
//         .join(`\n${rowDelimiter}\n`);
//
//     return [
//         headerDelimiter,
//         createHeadRow({value: 'DIFF', totalWidth}),
//         headerDelimiter,
//         _headers,
//         rowDelimiter,
//         _rows,
//         headerDelimiter,
//     ].join('\n');
// };
//
// // =============================================================================
// // Util
// // =============================================================================
//
// type Widths<C extends string> = Record<C, number>;
//
// function getWidths<C extends string>({
//     display,
//     previousWidths,
//     columns,
// }: {
//     display: Record<C, string>;
//     previousWidths: Widths<C>;
//     columns: readonly C[];
// }): Widths<C> {
//     return columns.reduce<Widths<C>>((widths, column) => {
//         widths[column] = Math.max(
//             // Name of column is the minimum length.
//             column.length,
//             widths[column],
//             display[column].length,
//         );
//         return widths;
//     }, previousWidths);
// }
//
// function getTotalWidth<C extends string>({
//     widths,
//     displayConfig: cfg,
// }: {
//     widths: Widths<C>;
//     displayConfig: DisplayConfig;
// }): number {
//     const all: number[] = Object.values(widths);
//     return (
//         all.reduce((m, width) => m + width) +
//         (all.length - 1) * cfg.columnDelimiter.length
//     );
// }
//
// function createHeaders<C extends string>({
//     columns,
//     widths,
// }: {
//     columns: readonly C[];
//     widths: Widths<C>;
// }): string {
//     return columns.map(column => column.padEnd(widths[column])).join(' | ');
// }
//
// function createHeadRow({
//     value,
//     totalWidth,
// }: {
//     value: string;
//     totalWidth: number;
// }): string {
//     return value.padStart(
//         Math.floor(totalWidth / 2) - Math.ceil(value.length / 2),
//     );
// }
//
// type DisplayConfig = {
//     /** @default true */
//     colorize: boolean;
//     /** @default ' │ ' */
//     columnDelimiter: string;
//     /** @default '-' */
//     rowDelimiter: string;
//     /** @default '=' */
//     headerDelimiter: string;
//     /** @default 2 */
//     columnPadding: number;
// };
