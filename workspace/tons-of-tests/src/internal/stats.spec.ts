import {expect, it} from '@effect/vitest';
import colors from 'ansi-colors';
import {Option} from 'effect';

import {Stats} from '../Classify.js';
import * as Show from '../Show.js';
import {TestRun} from '../Test.repository.js';

const rows = (text: string) =>
    colors
        .unstyle(text)
        .split('\n')
        .filter(line => line.startsWith('│'))
        .map(line =>
            line
                .split('│')
                .slice(1, -1)
                .map(cell => cell.trim()),
        );

it('shows built-in counts first and custom counts in exact name order', () => {
    const stats = Object.assign(Stats.empty(), {
        counts: {TP: 2, TN: 0, FP: 1, FN: 0, z: 1, a: 1, A: 1, precision: 4},
        total: 10,
        testCases: 3,
        precision: 2 / 3,
        recall: 1,
    });
    const output = Show.stats({
        testRun: {stats},
        displayConfig: {colorize: false, labels: {unused: {color: 'cyan'}}},
    });
    expect(rows(output).slice(1, 3)).toEqual([
        [
            'cases',
            'results',
            'TP',
            'TN',
            'FP',
            'FN',
            'A',
            'a',
            'precision (count)',
            'z',
            'precision',
            'recall',
            'timeMean',
            'timeMedian',
        ],
        [
            '3',
            '10',
            '2',
            '0',
            '1',
            '0',
            '1',
            '1',
            '4',
            '1',
            '0.67',
            '1.00',
            '-',
            '-',
        ],
    ]);
    expect(output).toBe(colors.unstyle(output));
    expect(output).not.toContain('unused');
});

it('keeps count selectors separate from metrics and shows explicitly selected absent counts as zero', () => {
    const stats = Object.assign(Stats.empty(), {
        counts: {total: 7, precision: 2, results: 1},
        total: 10,
        precision: 0.25,
    });
    const output = Show.stats({
        testRun: {stats},
        selectColumns: [
            'total',
            'count:total',
            'precision',
            'count:precision',
            'count:results',
            'count:unused',
            'count:constructor',
            'count:__proto__',
        ],
        displayConfig: {colorize: false},
    });
    expect(rows(output).slice(1, 3)).toEqual([
        [
            'results',
            'total',
            'precision',
            'precision (count)',
            'results (count)',
            'unused',
            'constructor',
            '__proto__',
        ],
        ['10', '7', '0.25', '2', '1', '0', '0', '0'],
    ]);
    expect(
        rows(
            Show.stats({testRun: {stats}, selectColumns: ['count:precision']}),
        )[1],
    ).toEqual(['precision']);
});

it('uses the union of run labels and distinguishes absent categories, empty runs, and missing runs', () => {
    const run = TestRun.make({
        id: 1,
        name: 'suite',
        variant: 'A',
        state: 'Complete',
        store: 'snapshot',
    });
    const statistics = [
        Option.some(
            Object.assign(Stats.empty(), {
                counts: {TP: 1, before: 2},
                total: 3,
                testCases: 1,
            }),
        ),
        Option.some(
            Object.assign(Stats.empty(), {
                counts: {after: 1},
                total: 1,
                testCases: 1,
            }),
        ),
        Option.some(Stats.empty()),
        Option.none<Stats>(),
    ];
    const output = Show.runSummaries({
        summaries: statistics.map((stats, index) => ({
            name: 'suite',
            variant: String(index),
            stats,
            run: Option.map(stats, () => run),
            source: 'snapshot',
            retired: false,
        })),
        displayConfig: {colorize: false, labels: {unused: {color: 'cyan'}}},
    });
    expect(rows(output)[1]).toEqual([
        'suite',
        'variant',
        'run',
        'source',
        'status',
        'cases',
        'results',
        'TP',
        'TN',
        'FP',
        'FN',
        'after',
        'before',
        'precision',
        'recall',
        'mean time',
    ]);
    expect(
        rows(output)
            .slice(2)
            .map(row => row.slice(5, 13)),
    ).toEqual([
        ['1', '3', '1', '0', '0', '0', '0', '2'],
        ['1', '1', '0', '0', '0', '0', '1', '0'],
        ['0', '0', '0', '0', '0', '0', '0', '0'],
        ['-', '-', '-', '-', '-', '-', '-', '-'],
    ]);
    expect(output).toBe(colors.unstyle(output));
    expect(output).not.toContain('unused');
});

it('uses explicit count colors and defaults custom colors from valence', () => {
    const stats = Object.assign(Stats.empty(), {
        counts: {TP: 2, recovered: 3, timeout: 4, undecided: 5},
        total: 14,
    });
    const output = Show.stats({
        testRun: {stats},
        displayConfig: {
            labels: {
                TP: {color: 'magenta'},
                recovered: {valence: 'positive'},
                timeout: {valence: 'negative'},
            },
        },
    });
    expect(output).toContain(colors.magenta('2'));
    expect(output).toContain(colors.green('3'));
    expect(output).toContain(colors.red('4'));
    expect(output).toContain(' 5 ');
});
