import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect, Schema} from 'effect';

import {createMapToDomain} from '../lib/math.js';
import {createTestCases} from './create-obesity-tests.js';

const mapCAECToObesity = createMapToDomain({min: 0, max: 3}, {min: 0, max: 6});

const predictObesity = ({eatBetweenMeals}: {eatBetweenMeals: number}) =>
    // Dumb approximation by loosely mapping between the domain.
    Effect.succeed(mapCAECToObesity(eatBetweenMeals) + 2);

CLI.run(
    {
        testSuite: {
            schemas: {
                testCase: {
                    input: Schema.Struct({
                        eatBetweenMeals: Schema.Int,
                        i: Schema.Int,
                    }),
                    expected: Schema.Finite,
                },
                evaluation: {result: Schema.Finite, expected: Schema.Finite},
            },
            name: 'with-cli-complex',
            testCases: await createTestCases(),
            program: predictObesity,
        },
        dbPath: 'with-cli-simple.db',
        concurrency: 1,
    },
    process.argv,
);
