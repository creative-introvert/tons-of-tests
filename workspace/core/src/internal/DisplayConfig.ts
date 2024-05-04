import type {DisplayConfig} from '../DisplayConfig.js';

export const makeDefault = (): DisplayConfig => ({
    colorize: true,
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
