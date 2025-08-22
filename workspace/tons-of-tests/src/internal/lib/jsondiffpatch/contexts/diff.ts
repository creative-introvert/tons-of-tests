import defaultClone from '../clone.js';
import type {Delta} from '../types.js';
import Context from './context.js';

class DiffContext extends Context<Delta> {
    left: unknown;
    right: unknown;
    pipe: 'diff';

    leftType?: string;
    rightType?: string;
    leftIsArray?: boolean;
    rightIsArray?: boolean;

    constructor(left: unknown, right: unknown) {
        super();
        this.left = left;
        this.right = right;
        this.pipe = 'diff';
    }

    setResult(result: Delta) {
        if (this.options!.cloneDiffValues && typeof result === 'object') {
            const clone =
                typeof this.options!.cloneDiffValues === 'function'
                    ? this.options!.cloneDiffValues
                    : defaultClone;
            if (typeof result[0] === 'object') {
                result[0] = clone(result[0]);
            }
            if (typeof result[1] === 'object') {
                result[1] = clone(result[1]);
            }
        }
        return super.setResult(result);
    }
}

export default DiffContext;
