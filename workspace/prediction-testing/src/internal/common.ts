import colors from 'ansi-colors';
import {sum} from 'effect/Number';

import type {DisplayConfig} from '../DisplayConfig.js';

export const showBorder = (
    cfg: DisplayConfig,
    columnWidths: number[],
    position: 'top' | 'top-title' | 'middle' | 'bottom-title' | 'bottom',
): string => {
    const l = {
        'top-title': cfg.cornerTopLeft,
        top: cfg.cornerTopLeft,
        middle: cfg.cornerLeft,
        'bottom-title': cfg.cornerLeft,
        bottom: cfg.cornerBottomLeft,
    };

    const r = {
        'top-title': cfg.cornerTopRight,
        top: cfg.cornerTopRight,
        middle: cfg.cornerRight,
        'bottom-title': cfg.cornerRight,
        bottom: cfg.cornerBottomRight,
    };

    const m = {
        'top-title': cfg.horizontal,
        top: cfg.cornerTop,
        middle: cfg.corner,
        'bottom-title': cfg.cornerTop,
        bottom: cfg.cornerBottom,
    };

    return (
        l[position] +
        columnWidths.reduce(
            (s, w, i, xs) =>
                s +
                (i < xs.length - 1
                    ? cfg.horizontal.repeat(w + cfg.columnPadding) + m[position]
                    : cfg.horizontal.repeat(w + cfg.columnPadding)),
            '',
        ) +
        r[position] +
        '\n'
    );
};

export const showHeader = (
    cfg: DisplayConfig,
    columnWidths: number[],
    columns: {label: string}[],
): string => {
    return (
        columns
            .map(
                ({label}, i) =>
                    cfg.vertical + ' ' + label.padEnd(columnWidths[i]) + ' ',
            )
            .join('') +
        cfg.vertical +
        '\n'
    );
};

export const showTitle = (
    cfg: DisplayConfig,
    columnWidths: number[],
    title: string,
): string => {
    const diff = title.length - colors.stripColor(title).length;
    return (
        showBorder(cfg, columnWidths, 'top-title') +
        cfg.vertical +
        title
            .padStart(title.length + 1)
            .padEnd(
                diff + columnWidths.reduce(sum) + columnWidths.length * 3 - 1,
            ) +
        cfg.vertical +
        '\n' +
        showBorder(cfg, columnWidths, 'bottom-title')
    );
};

export const showRow = (
    cfg: DisplayConfig,
    row: [string, string[]][],
    columnWidths: number[],
    height: number,
) => {
    let s = '';
    for (let j = 0; j < height; j++) {
        for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
            const [key, values] = row[columnIndex];
            const x = values[j];
            const u = colors.stripColor(x);
            const w = columnWidths[columnIndex];
            const n = w + x.length - u.length;
            s += cfg.vertical + ' ' + x.padEnd(n) + ' ';
        }
        s += cfg.vertical + '\n';
    }
    return s;
};

export const colorPositive = (n: number) =>
    n < 0 ? colors.red : n > 0 ? colors.green : colors.white;

export const colorNegative = (n: number) =>
    n > 0 ? colors.red : n < 0 ? colors.green : colors.white;
