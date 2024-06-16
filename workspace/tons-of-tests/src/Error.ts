import {TestResult} from './Test.js';
import * as P from './prelude.js';

export class DuplicateTestResult extends P.Data.TaggedError(
    'DuplicateTestResult',
)<TestResult> {
    static tag = 'DuplicateTestResult' as const;
}
