import type * as PT from '@creative-introvert/tons-of-tests';
import {Context, Layer} from 'effect';

export type Config<I = unknown, O = unknown, T = unknown> = {
    testSuite: PT.Test.TestSuite<I, O, T>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency?: number | undefined;
};

export const Config = Context.GenericTag<Config>('Config');

export const makeConfigLayer = (config: Config) =>
    Layer.sync(Config, () => Config.of(config));
