import type * as PT from '@creative-introvert/prediction-testing';
import * as CLI from '@creative-introvert/prediction-testing-cli';
import {Effect} from 'effect';

void CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: [
            {input: {BRAND: '1'}, expected: {BRAND: '1'}},
            {input: {BRAND: '2'}, expected: {BRAND: '2'}},
            {
                input: {BRAND: '3', MODEL: 8100},
                expected: {BRAND: '3', MODEL: 8100},
            },
            {
                input: {
                    BRAND: '4',
                    MODEL: 8400,
                    MACHINE_TYPE: 'tractor',
                },
                expected: {
                    BRAND: '4',
                    MODEL: 8400,
                },
            },
        ],
        program: ({BRAND, MODEL}) => Effect.sync(() => ({MODEL, BRAND})),
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 2,
});
