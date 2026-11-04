import colors from 'ansi-colors';

import type {
    DisplayConfig,
    LabelColor,
    LabelDisplay,
} from '../DisplayConfig.js';
import {ConfusionLabelSchema} from './Classify.js';

export const makeDefault = (): DisplayConfig => ({
    colorize: true,
    labels: {},
    columnPadding: 2,
    corner: '┼',
    cornerLeft: '├',
    cornerRight: '┤',
    cornerTop: '┬',
    cornerTopLeft: '┌',
    cornerTopRight: '┐',
    cornerBottomLeft: '└',
    cornerBottomRight: '┘',
    cornerBottom: '┴',
    horizontal: '─',
    vertical: '│',
});

/** Built-ins first, then custom names in exact string order. */
export const countLabels = (
    counts: ReadonlyArray<Readonly<Record<string, number>>>,
): string[] => {
    const builtins: readonly string[] = ConfusionLabelSchema.literals;
    const custom = new Set(counts.flatMap(Object.keys));
    for (const label of builtins) custom.delete(label);
    return [...builtins, ...[...custom].sort()];
};

const labelDisplay = (cfg: DisplayConfig, label: string) => {
    const setting: LabelDisplay = Object.hasOwn(cfg.labels, label)
        ? cfg.labels[label]
        : {};
    const builtin =
        label === 'TP' || label === 'TN' || label === 'FP' || label === 'FN';
    const valence =
        setting.valence ??
        (label === 'TP' || label === 'TN'
            ? 'positive'
            : label === 'FP' || label === 'FN'
              ? 'negative'
              : 'neutral');
    const color =
        setting.color ??
        (valence === 'positive'
            ? 'green'
            : valence === 'negative'
              ? 'red'
              : 'none');
    return {setting, builtin, valence, color};
};

const colorText = (
    cfg: DisplayConfig,
    color: LabelColor,
    text: string,
): string => (cfg.colorize && color !== 'none' ? colors[color](text) : text);

export const showLabel = (
    cfg: DisplayConfig,
    label: string,
    fresh = false,
): string => {
    const {setting, builtin, valence, color} = labelDisplay(cfg, label);
    return colorText(
        cfg,
        fresh &&
            builtin &&
            setting.color === undefined &&
            setting.valence === undefined
            ? valence === 'positive'
                ? 'blue'
                : 'yellow'
            : color,
        label,
    );
};

export const showCount = (
    cfg: DisplayConfig,
    label: string,
    value: number,
): string => {
    const {setting, builtin, color} = labelDisplay(cfg, label);
    return colorText(
        cfg,
        value === 0 &&
            builtin &&
            setting.color === undefined &&
            setting.valence === undefined
            ? 'white'
            : color,
        String(value),
    );
};

export const showCountDiff = (
    cfg: DisplayConfig,
    label: string,
    value: number,
): string => {
    if (value === 0) return '0';
    const {valence, color} = labelDisplay(cfg, label);
    return colorText(
        cfg,
        valence === 'neutral'
            ? color
            : value > 0 === (valence === 'positive')
              ? 'green'
              : 'red',
        String(value),
    );
};

/** Disambiguate a count only when its table also contains that metric header. */
export const countHeader = (
    label: string,
    metricHeaders: readonly string[],
): string => (metricHeaders.includes(label) ? `${label} (count)` : label);
