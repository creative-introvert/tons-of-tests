import type {Stats} from './Classify.js';
import type {Diff} from './Test.js';
import type {TestRun} from './Test.js';
import type * as P from './prelude.js';

export {summarize} from './internal/summarize.js';
export {diff} from './internal/diff.js';
export {stats} from './internal/stats.js';

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
    | 'recall';

export type StatsColumn = {
    name: StatsColumnNames;
    label: string;
    make: (ctx: StatsContext) => string[];
};

export type SummarizeContext = {
    i: number;
    ids: string[];
    testRun: TestRun;
    previousTestRun: P.O.Option<TestRun>;
};

export type SummarizeColumnNames =
    | 'index'
    | 'hash'
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
