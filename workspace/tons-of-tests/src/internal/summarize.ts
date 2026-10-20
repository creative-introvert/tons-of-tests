import colors from 'ansi-colors';
import {
    Array as A,
    Effect,
    FileSystem,
    Option,
    Record,
    Schema,
    Stream,
} from 'effect';

import type {DisplayConfig} from '../DisplayConfig.js';
import type {
    SummarizeColumn,
    SummarizeColumnNames,
    SummarizeContext,
} from '../Show.js';
import type {TestResultComparison, TestRunResults} from '../Test.js';
import type {TestResultSchemas, TestRun} from '../Test.repository.js';
import {makeResultCodec} from './Test.serialization.js';
import {showBorder, showHeader, showRow, showTitle} from './common.js';
import {makeDefault} from './DisplayConfig.js';
import {formatDiff} from './format-diff.js';
import {diff} from './lib/jsondiffpatch/index.js';

type ColumnContext = Omit<
    SummarizeContext<Schema.Json, Schema.Json, Schema.Json>,
    'resultKeys'
> & {
    resultCount: number;
};
const columns: Array<
    Omit<SummarizeColumn, 'make'> & {make: (context: ColumnContext) => string[]}
> = [
    {
        name: 'index',
        label: '#/∑',
        make: ({i, resultCount}: ColumnContext) => [
            colors.dim(`${i + 1}/${resultCount}`),
        ],
    },
    {
        name: 'hash',
        label: 'hash',
        make: ({testResult, previousTestResult}: ColumnContext) => {
            // TODO: Highlight more:
            // 1. red when test "changed bad"
            // 2. green when test "changed good"
            // 3. blue when test is new?
            const color = Option.isNone(previousTestResult)
                ? colors.green
                : colors.white;
            const hash = testResult.hashTestCase.slice(0, 8);
            return [color(hash)];
        },
    },
    {
        name: 'key',
        label: 'key',
        make: ({testResult}: ColumnContext) => [testResult.key],
    },
    {
        name: 'timeMillis',
        label: 'ms',
        make: ({testResult}: ColumnContext) => [
            `${testResult.timeMillis.toFixed(2)}${colors.dim('ms')}`,
        ],
    },
    {
        name: 'tags',
        label: 'tags',
        make: ({testResult}: ColumnContext) => [...testResult.tags],
    },
    {
        name: 'input',
        label: 'input',
        make: ({testResult}: ColumnContext) =>
            JSON.stringify(testResult.input, null, 2).split('\n'),
    },
    {
        name: 'expected',
        label: 'expected',
        make: ({testResult}: ColumnContext) =>
            JSON.stringify(testResult.expected, null, 2).split('\n'),
    },
    {
        name: 'label',
        label: 'label',
        make: ({testResult, previousTestResult}: ColumnContext) => {
            const hasPrevious = Option.isSome(previousTestResult);
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
        name: 'result',
        label: 'result',
        make: ({testResult}: ColumnContext) =>
            JSON.stringify(testResult.result, null, 2).split('\n'),
    },
    {
        name: 'result_diff',
        label: 'diff result',
        make: ({testResult}: ColumnContext) =>
            formatDiff(diff(testResult.expected, testResult.result))?.split(
                '\n',
            ) || [],
    },
    {
        name: 'prev_label',
        label: 'label₋₁',
        make: ({previousTestResult}: ColumnContext) => {
            const label = Option.match(previousTestResult, {
                onNone: () => '',
                onSome: _ =>
                    _.label === 'TP' || _.label === 'TN'
                        ? colors.green(_.label)
                        : colors.red(_.label),
            });

            return [label];
        },
    },
    {
        name: 'prev_result',
        label: 'result₋₁',
        make: ({previousTestResult}: ColumnContext) =>
            previousTestResult.pipe(
                Option.map(_ => JSON.stringify(_.result, null, 2)?.split('\n')),
                Option.getOrElse<string[]>(() => []),
            ),
    },
    {
        name: 'prev_result_diff',
        label: 'diff result₋₁',
        make: ({testResult, previousTestResult}: ColumnContext) =>
            previousTestResult.pipe(
                Option.map(
                    _ =>
                        formatDiff(diff(testResult.expected, _.result))?.split(
                            '\n',
                        ) || [],
                ),
                Option.getOrElse<string[]>(() => []),
            ),
    },
];

const defaultColumns: A.NonEmptyArray<SummarizeColumnNames> = [
    'index',
    'hash',
    'key',
    'timeMillis',
    'tags',
    'input',
    'expected',
    'label',
    'result_diff',
    'prev_label',
    'prev_result_diff',
];

const makeRow = (selected: typeof columns, context: ColumnContext) => {
    const row: [string, string[]][] = selected.map(({label, make}) => [
        label,
        make(context),
    ]);
    const height = row.reduce(
        (height, [, values]) => Math.max(height, values.length),
        1,
    );
    for (const [, values] of row) {
        if (values.length < height)
            values.push(...A.makeBy(height - values.length, () => ''));
    }
    return row;
};

const measureRow = (
    widths: number[],
    row: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
) =>
    widths.map((width, index) => {
        for (const value of row[index][1])
            width = Math.max(width, colors.unstyle(value).length);
        return width;
    });

/** Format schema-encoded values; conversion failures stay in the error channel. */
export const showSummary = Effect.fnUntraced(function* <I, O, T>({
    testRun,
    schemas,
    displayConfig,
    previousTestRun = Option.none(),
    selectColumns = defaultColumns,
}: {
    testRun: TestRunResults<I, O, T>;
    schemas: TestResultSchemas<I, O, T>;
    previousTestRun?: Option.Option<TestRunResults<I, O, T>>;
    displayConfig?: Partial<DisplayConfig> | undefined;
    selectColumns?: A.NonEmptyArray<SummarizeColumnNames>;
}) {
    const codec = makeResultCodec(schemas, testRun.name);
    const cfg = {...makeDefault(), ...displayConfig};

    const resultKeys = testRun.testResultKeys;

    const _columns = columns
        .filter(c => selectColumns.includes(c.name))
        .filter(
            c => !c.name.startsWith('prev_') || Option.isSome(previousTestRun),
        );
    let columnWidths = _columns.map(m => m.label.length);

    const rows = [];

    for (let i = 0; i < resultKeys.length; i++) {
        const key = resultKeys[i];
        const testResult = yield* codec.encode(testRun.testResultsByKey[key]);
        const previous = previousTestRun.pipe(
            Option.flatMap(_ => Record.get(_.testResultsByKey, key)),
        );
        const previousTestResult = Option.isSome(previous)
            ? Option.some(yield* codec.encode(previous.value))
            : Option.none();

        const row = makeRow(_columns, {
            i,
            resultCount: resultKeys.length,
            testResult,
            previousTestResult,
        });
        columnWidths = measureRow(columnWidths, row);
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
});

const decodeRow = Schema.decodeUnknownEffect(
    Schema.fromJsonString(
        Schema.Array(
            Schema.Tuple([Schema.String, Schema.Array(Schema.String)]),
        ),
    ),
);

/**
 * Format rows once into a temporary file, then read them back with final column widths.
 * Use inside Effect.scoped; the returned chunks remain readable until that scope closes.
 * Each chunk ends in a newline. Conversion failures fail report preparation.
 */
export const prepareSummary = Effect.fnUntraced(function* <I, O, T, E, R>(
    results: Stream.Stream<
        Pick<SummarizeContext<I, O, T>, 'testResult' | 'previousTestResult'>,
        E,
        R
    >,
    {
        schemas,
        suite,
        displayConfig,
        hasPrevious = false,
        selectColumns = defaultColumns,
    }: {
        schemas: TestResultSchemas<I, O, T>;
        suite: string;
        displayConfig?: Partial<DisplayConfig> | undefined;
        hasPrevious?: boolean;
        selectColumns?: A.NonEmptyArray<SummarizeColumnNames>;
    },
) {
    const codec = makeResultCodec(schemas, suite);
    const selected = columns
        .filter(column => selectColumns.includes(column.name))
        .filter(column => !column.name.startsWith('prev_') || hasPrevious);
    const rows = results.pipe(
        Stream.zipWithIndex,
        Stream.mapEffect(
            Effect.fnUntraced(function* ([context, i]) {
                const testResult = yield* codec.encode(context.testResult);
                const previousTestResult = Option.isSome(
                    context.previousTestResult,
                )
                    ? Option.some(
                          yield* codec.encode(context.previousTestResult.value),
                      )
                    : Option.none();
                return makeRow(selected, {
                    testResult,
                    previousTestResult,
                    i,
                    resultCount: 0,
                });
            }),
        ),
    );
    return yield* prepareTable(rows, {
        columns: selected,
        title: 'SUMMARY',
        indexColumn: selected.findIndex(column => column.name === 'index'),
        displayConfig,
    });
});

/**
 * Show added and removed results with `-` where the other side is missing.
 * Each side uses its own suite name when reporting a codec failure.
 * Prepare and consume the chunks inside `Effect.scoped` so temporary files stay available.
 */
export const prepareComparison = Effect.fnUntraced(function* <I, A, B, E, R>(
    comparisons: Stream.Stream<TestResultComparison<I, A, B>, E, R>,
    {
        from,
        to,
        schemas,
        displayConfig,
    }: {
        from: Option.Option<TestRun>;
        to: TestRun;
        schemas: TestResultSchemas<I, A, B>;
        displayConfig?: Partial<DisplayConfig> | undefined;
    },
) {
    const fromCodec = Option.map(from, run =>
        makeResultCodec(schemas, run.name),
    );
    const toCodec = makeResultCodec(schemas, to.name);
    const labels = [
        '#/∑',
        'change',
        'key',
        'input',
        'from label',
        'from expected',
        'from result',
        'to label',
        'to expected',
        'to result',
    ];
    const rows = comparisons.pipe(
        Stream.mapEffect(
            Effect.fnUntraced(function* (comparison) {
                const before =
                    comparison._tag === 'OnlyTo'
                        ? undefined
                        : yield* Option.getOrThrow(fromCodec).encode(
                              comparison.from,
                          );
                const after =
                    comparison._tag === 'OnlyFrom'
                        ? undefined
                        : yield* toCodec.encode(comparison.to);
                const result =
                    comparison._tag === 'OnlyFrom'
                        ? comparison.from
                        : comparison.to;
                const fields = [
                    '',
                    comparison._tag === 'OnlyFrom'
                        ? 'removed'
                        : comparison._tag === 'OnlyTo'
                          ? 'added'
                          : comparison.changed
                            ? 'changed'
                            : 'unchanged',
                    result.key,
                    JSON.stringify(
                        after === undefined ? before?.input : after.input,
                        null,
                        2,
                    ),
                    before?.label ?? '-',
                    before === undefined
                        ? '-'
                        : JSON.stringify(before.expected, null, 2),
                    before === undefined
                        ? '-'
                        : JSON.stringify(before.result, null, 2),
                    after?.label ?? '-',
                    after === undefined
                        ? '-'
                        : JSON.stringify(after.expected, null, 2),
                    after === undefined
                        ? '-'
                        : JSON.stringify(after.result, null, 2),
                ];
                return fields.map((value, index): [string, string[]] => [
                    labels[index],
                    value.split('\n'),
                ]);
            }),
        ),
    );
    const identity = (run: TestRun) =>
        `${run.name} / ${run.variant} / ${run.store === 'snapshot' ? `run:${run.id}` : 'cached attempt'}`;
    const previous = Option.match(from, {
        onNone: () => 'no baseline',
        onSome: identity,
    });
    const table = yield* prepareTable(rows, {
        columns: labels.map(label => ({label})),
        title: 'COMPARISON',
        indexColumn: 0,
        displayConfig,
    });
    return {
        ...table,
        chunks: Stream.make(`from: ${previous}\nto: ${identity(to)}\n`).pipe(
            Stream.concat(table.chunks),
        ),
    };
});

const prepareTable = Effect.fnUntraced(function* <E, R>(
    formattedRows: Stream.Stream<
        ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
        E,
        R
    >,
    {
        columns,
        title,
        indexColumn,
        displayConfig,
    }: {
        columns: {label: string}[];
        title: string;
        indexColumn: number;
        displayConfig?: Partial<DisplayConfig> | undefined;
    },
) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* fs.makeTempFileScoped({
        prefix: 'tons-of-tests-summary-',
        suffix: '.jsonl',
    });
    const cfg = {...makeDefault(), ...displayConfig};
    let widths = columns.map(column => column.label.length);
    let count = 0;
    yield* formattedRows.pipe(
        Stream.map(row => {
            const height = row.reduce(
                (height, [, values]) => Math.max(height, values.length),
                1,
            );
            const padded = row.map(
                ([label, values]) =>
                    [
                        label,
                        [
                            ...values,
                            ...Array.from(
                                {length: height - values.length},
                                () => '',
                            ),
                        ],
                    ] as const,
            );
            widths = measureRow(widths, padded);
            count++;
            return `${JSON.stringify(padded)}\n`;
        }),
        Stream.encodeText,
        Stream.run(fs.sink(path)),
    );
    if (indexColumn >= 0)
        widths[indexColumn] = Math.max(
            widths[indexColumn],
            `${count}/${count}`.length,
        );
    const header = showHeader(cfg, widths, columns);
    const start =
        showTitle(cfg, widths, colors.bold(title)) +
        header +
        showBorder(cfg, widths, 'middle');
    const end = header + showBorder(cfg, widths, 'bottom');
    const rows = fs.stream(path).pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter(line => line.length > 0),
        Stream.mapEffect(line => decodeRow(line)),
        Stream.zipWithIndex,
        Stream.map(([row, index]) => {
            const numbered = row.map(
                ([label, values], column) =>
                    [
                        label,
                        column === indexColumn
                            ? [
                                  colors.dim(`${index + 1}/${count}`),
                                  ...values.slice(1),
                              ]
                            : values,
                    ] as const,
            );
            return (
                showRow(cfg, numbered, widths, row[0][1].length) +
                showBorder(cfg, widths, 'middle')
            );
        }),
    );
    return {
        count,
        chunks: Stream.make(start).pipe(
            Stream.concat(rows),
            Stream.concat(Stream.make(end)),
        ),
    };
});
