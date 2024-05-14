import type * as PT from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

void CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: [
            {input: {BRAND: '1'}, expected: {BRAND: '1'}},
            {input: null, expected: {BRAND: '2'}},
            {input: {BRAND: '3', MODEL: 8100}, expected: null},
            {input: null, expected: null},
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        program: (args: any) =>
            Effect.sync(() => args && {MODEL: args?.MODEL, BRAND: args?.BRAND}),
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 2,
});
