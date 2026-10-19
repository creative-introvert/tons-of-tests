import type * as PT from '@creative-introvert/tons-of-tests';

export type AppConfigShape<
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
    A = O,
    B = T,
> = {
    testSuite: PT.Test.TestSuite<I, O, T, E, R, A, B>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency?: number | undefined;
};
