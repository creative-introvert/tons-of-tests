import * as internal from './internal/DisplayConfig.js';

export type DisplayConfig = {
    /** @default true */
    colorize: boolean;
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
