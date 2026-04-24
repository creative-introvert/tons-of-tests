import type * as PT from '@creative-introvert/tons-of-tests';
import {Context, Layer} from 'effect';

export type AppConfigShape<
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
> = {
    testSuite: PT.Test.TestSuite<I, O, T, E, R>;
    dbPath: string;
    displayConfig?: Partial<PT.DisplayConfig.DisplayConfig> | undefined;
    concurrency?: number | undefined;
};

export class AppConfig extends Context.Tag('AppConfig')<
    AppConfig,
    AppConfigShape
>() {
    static readonly layer = <I, O, T, E, R>(
        value: AppConfigShape<I, O, T, E, R>,
    ) => Layer.succeed(AppConfig, value as AppConfigShape);
}
