import type * as PT from '@creative-introvert/tons-of-tests';

export type AppConfigShape<
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = PT.Test.TestSuite<I, O, T, never, never, A, B>,
> = {
    testSuite: PT.Test.TestSuite<I, O, T, unknown, unknown, A, B> &
        PT.Test.InferTestSuite<S>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency?: number | undefined;
};
