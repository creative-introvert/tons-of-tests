import {expect, it} from '@effect/vitest';
import colors from 'ansi-colors';
import {Option} from 'effect';

import {Stats} from '../Classify.js';
import type {LabelDisplay} from '../DisplayConfig.js';
import * as Show from '../Show.js';
import * as Test from '../Test.js';

it.each([
    {valence: 'positive', value: 2, color: 'green'},
    {valence: 'positive', value: -2, color: 'red'},
    {valence: 'positive', value: 0, color: 'none'},
    {valence: 'negative', value: 2, color: 'red'},
    {valence: 'negative', value: -2, color: 'green'},
    {valence: 'negative', value: 0, color: 'none'},
    {valence: 'neutral', value: 2, color: 'magenta'},
    {valence: 'neutral', value: -2, color: 'magenta'},
    {valence: 'neutral', value: 0, color: 'none'},
] as const)(
    'colors $valence count difference $value by valence independently of category color',
    ({valence, value, color}) => {
        const output = Show.diff({
            diff: {counts: {timeout: value}, precision: 0, recall: 0},
            selectColumns: ['count:timeout'],
            displayConfig: {labels: {timeout: {color: 'magenta', valence}}},
        });
        const cell = output
            .replaceAll(colors.gray('│'), '│')
            .split('\n')
            .filter(line => line.startsWith('│'))[2]
            .split('│')[1]
            .trim();
        expect(cell).toBe(
            color === 'none' ? String(value) : colors[color](String(value)),
        );
    },
);

it.each([
    {label: 'TP', setting: {}, value: 1, color: 'green'},
    {label: 'FN', setting: {}, value: -1, color: 'green'},
    {label: 'undecided', setting: {}, value: 1, color: 'none'},
    {
        label: 'undecided',
        setting: {color: 'none', valence: 'neutral'},
        value: -1,
        color: 'none',
    },
] satisfies ReadonlyArray<{
    label: string;
    setting: LabelDisplay;
    value: number;
    color: 'green' | 'none';
}>)('uses default valence for $label', ({label, setting, value, color}) => {
    const output = Show.diff({
        diff: {counts: {[label]: value}, precision: 0, recall: 0},
        selectColumns: [`count:${label}`],
        displayConfig: {labels: {[label]: setting}},
    });
    const cell = output
        .replaceAll(colors.gray('│'), '│')
        .split('\n')
        .filter(line => line.startsWith('│'))[2]
        .split('│')[1]
        .trim();
    expect(cell).toBe(
        color === 'none' ? String(value) : colors[color](String(value)),
    );
});

it('shows labels from both runs, separates metric selectors, and disables all ANSI styling', () => {
    const previous = Object.assign(Stats.empty(), {
        counts: {old: 2, precision: 1},
    });
    const current = Object.assign(Stats.empty(), {
        counts: {new: 3, precision: 4},
        precision: 0.5,
    });
    const diff = Test.diff({
        testRun: {stats: current},
        previousTestRun: Option.some({stats: previous}),
    });
    const output = Show.diff({
        diff,
        displayConfig: {
            colorize: false,
            labels: {old: {color: 'magenta'}, new: {valence: 'positive'}},
        },
    });
    const rows = output
        .split('\n')
        .filter(line => line.startsWith('│'))
        .map(line =>
            line
                .split('│')
                .slice(1, -1)
                .map(cell => cell.trim()),
        );
    expect(rows.slice(1, 3)).toEqual([
        [
            'TP',
            'TN',
            'FP',
            'FN',
            'new',
            'old',
            'precision (count)',
            'precision',
            'recall',
        ],
        ['0', '0', '0', '0', '3', '-2', '3', '0.50', '0.00'],
    ]);
    expect(output).toBe(colors.unstyle(output));
});
