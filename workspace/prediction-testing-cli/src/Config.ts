import type * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';

export type Config<I = unknown, O = unknown, T = unknown> = {
    testSuite: PT.Test.TestSuite<I, O, T>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency: number | undefined;
};

export const Config = P.Context.GenericTag<Config>('Config');

export const makeConfigLayer = (config: Config) =>
    P.Layer.sync(Config, () => Config.of(config));
