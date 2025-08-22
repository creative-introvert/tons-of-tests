import type Context from './contexts/context.js';
import type DiffContext from './contexts/diff.js';
import type PatchContext from './contexts/patch.js';
import type ReverseContext from './contexts/reverse.js';
import dateReviver from './date-reviver.js';
import DiffPatcher from './diffpatcher.js';
import type {Delta, Options} from './types.js';

export {DiffPatcher, dateReviver};

export type * from './types.js';
export type {Context, DiffContext, PatchContext, ReverseContext};

export function create(options?: Options) {
    return new DiffPatcher(options);
}

let defaultInstance: DiffPatcher;

export function diff(left: unknown, right: unknown) {
    if (!defaultInstance) {
        defaultInstance = new DiffPatcher();
    }
    return defaultInstance.diff(left, right);
}

export function patch(left: unknown, delta: Delta) {
    if (!defaultInstance) {
        defaultInstance = new DiffPatcher();
    }
    return defaultInstance.patch(left, delta);
}

export function unpatch(right: unknown, delta: Delta) {
    if (!defaultInstance) {
        defaultInstance = new DiffPatcher();
    }
    return defaultInstance.unpatch(right, delta);
}

export function reverse(delta: Delta) {
    if (!defaultInstance) {
        defaultInstance = new DiffPatcher();
    }
    return defaultInstance.reverse(delta);
}

export function clone(value: unknown) {
    if (!defaultInstance) {
        defaultInstance = new DiffPatcher();
    }
    return defaultInstance.clone(value);
}
