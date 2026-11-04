import * as internal from './internal/DisplayConfig.js';

export type LabelColor =
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'gray'
    | 'none';

export type LabelDisplay = {
    readonly color?: LabelColor;
    /** Positive means more is better; negative means fewer is better. Custom labels default to neutral. */
    readonly valence?: 'positive' | 'negative' | 'neutral';
};

export type DisplayConfig = {
    /** @default true */
    colorize: boolean;
    /**
     * Presentation only. Current settings also apply to cached and committed runs.
     * TP/TN default to positive, FP/FN to negative, and custom labels to neutral.
     * Without a color, positive labels are green, negative labels red, and neutral
     * labels uncolored. Built-in labels keep their usual styling without overrides.
     */
    labels: Readonly<Record<string, LabelDisplay>>;
    /** @default 2 */
    columnPadding: number;
    corner: string;
    cornerLeft: string;
    cornerRight: string;
    cornerTop: string;
    cornerTopLeft: string;
    cornerTopRight: string;
    cornerBottomLeft: string;
    cornerBottomRight: string;
    cornerBottom: string;
    horizontal: string;
    vertical: string;
};

export const makeDefault = internal.makeDefault;
