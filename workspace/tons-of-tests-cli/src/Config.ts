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
    /**
     * Snapshot database. Only `commit` creates or changes this file.
     * With `:memory:`, baselines last for the shared repository layer's lifetime.
     */
    dbPath: string;
    /**
     * Disposable cache filename. Defaults to `.cache/tons-of-tests/<hash>.sqlite`
     * under the invocation's working directory. The hash is SHA-256 of the normalized
     * absolute snapshot path, or of `:memory:` and the absolute working directory.
     * A `:memory:` snapshot still uses this disk cache by default.
     *
     * The cache keeps only the latest attempt per snapshot identity, suite, and
     * variant, even when several snapshot databases share this filename.
     * `--cached` reuses that attempt if complete, even after program code changes.
     * Missing, running, or failed attempts rerun. Complete empty attempts are reusable.
     *
     * Set `:memory:` to keep the cache only for the repository layer's lifetime.
     * File paths must refer to different cache and snapshot files.
     */
    cachePath?: string | undefined;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency?: number | undefined;
};
