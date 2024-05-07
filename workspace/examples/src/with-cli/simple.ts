import type * as PT from '@creative-introvert/prediction-testing';
import * as CLI from '@creative-introvert/prediction-testing-cli';
import {Effect} from 'effect';

type TestCase = PT.Test.TestCase<unknown, {BRAND: string; MODEL?: number}>;

const testCases: TestCase[] = [
    {input: null, expected: {BRAND: 'Claas'}},
    {input: {BRAND: 'Claas'}, expected: {BRAND: 'Claas'}},
    {input: {BRAND: 'John Deere'}, expected: {BRAND: 'John Deere'}},
    {
        input: {BRAND: 'John Deere', MODEL: 8100},
        expected: {BRAND: 'John Deere', MODEL: 8300},
    },
    {
        input: {
            BRAND: 'John Deere',
            MODEL: 8400,
            MACHINE_TYPE: 'tractor',
        },
        expected: {
            BRAND: 'John Deere',
            MODEL: 8400,
        },
        tags: ['tractor', 'asdf'],
    },
];

void CLI.main({
    testSuite: {
        name: 'with-cli-simple',
        program: a => Effect.sync(() => a),
        testCases,
    },
    dbPath: 'with-cli-simple.db',
});
