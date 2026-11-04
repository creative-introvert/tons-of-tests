import type {Option} from 'effect';

import type {Stats} from './Classify.js';
import type {Diff, TestResult} from './Test.js';

export {showDiff as diff} from './internal/diff.js';
export {
    showStats as stats,
    showRunSummaries as runSummaries,
} from './internal/stats.js';
export {
    showSummary as summarize,
    prepareSummary,
    prepareComparison,
} from './internal/summarize.js';

export type DiffContext = {
    diff: Diff;
};

/** Select a label with `count:<label>`; precision and recall use only TP/FP/FN. */
export type DiffColumnNames = `count:${string}` | 'precision' | 'recall';

export type DiffColumn = {
    name: DiffColumnNames;
    label: string;
    make: (ctx: DiffContext) => string[];
};

export type StatsContext = {
    stats: Stats;
};

/** Use `count:<label>` for counts, including unused labels as zero. Metric names select metrics. */
export type StatsColumnNames =
    | 'total'
    | 'testCases'
    | `count:${string}`
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

export type SummarizeContext<I = unknown, O = unknown, T = unknown> = {
    i: number;
    resultKeys: string[];
    testResult: TestResult<I, O, T>;
    previousTestResult: Option.Option<TestResult<I, O, T>>;
};

export type SummarizeColumnNames =
    | 'index'
    | 'hash'
    | 'key'
    | 'timeMillis'
    | 'input'
    | 'tags'
    | 'label'
    | 'expected'
    | 'result'
    | 'result_diff'
    | 'prev_label'
    | 'prev_result'
    | 'prev_result_diff';

export type SummarizeColumn = {
    name: SummarizeColumnNames;
    label: string;
    make: (ctx: SummarizeContext) => string[];
};
