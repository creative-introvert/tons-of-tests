import type {Stats} from './Classify.js';
import type {Diff, TestResult} from './Test.js';
import type {TestRunResults} from './Test.js';
import type * as P from './prelude.js';

export {showSummary as summarize} from './internal/summarize.js';
export {showDiff as diff} from './internal/diff.js';
export {showStats as stats} from './internal/stats.js';

export type DiffContext = {
    diff: Diff;
};

export type DiffColumnNames =
    | 'TP'
    | 'TN'
    | 'FP'
    | 'FN'
    | 'precision'
    | 'recall';

export type DiffColumn = {
    name: DiffColumnNames;
    label: string;
    make: (ctx: DiffContext) => string[];
};

export type StatsContext = {
    stats: Stats;
};

export type StatsColumnNames =
    | 'TP'
    | 'TN'
    | 'FP'
    | 'FN'
    | 'precision'
    | 'recall'
    | 'timeMin'
    | 'timeMax'
    | 'timeMean'
    | 'timeMedian';

export type StatsColumn = {
    name: StatsColumnNames;
    label: string;
    make: (ctx: StatsContext) => string[];
};

export type SummarizeContext = {
    i: number;
    hashes: string[];
    testResult: TestResult;
    previousTestResult: P.Option.Option<TestResult>;
};

export type SummarizeColumnNames =
    | 'index'
    | 'hash'
    | 'timeMillis'
    | 'input'
    | 'tags'
    | 'label'
    | 'expected'
    | 'result'
    | 'result_diff'
    | 'prev_result'
    | 'prev_result_diff';

export type SummarizeColumn = {
    name: SummarizeColumnNames;
    label: string;
    make: (ctx: SummarizeContext) => string[];
};
