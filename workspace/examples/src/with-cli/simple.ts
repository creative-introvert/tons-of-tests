import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

void CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: [
            {
                input: 1,
                expected: 1.1,
                tags: ['a'],
            },
            {
                input: 2,
                expected: 2.2,
                tags: ['a', 'b'],
            },
            {
                input: 3,
                expected: 3.3,
                tags: ['b'],
            },
        ],
        program: n =>
            Effect.sync(() => Number.parseFloat((n * 1.1).toFixed(1))),
    },
    dbPath: 'with-cli-simple.db',
});
