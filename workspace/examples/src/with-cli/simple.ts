import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

import {createMapToDomain} from '../lib/math.js';
import {createTestCases} from './create-obesity-tests.js';

const mapCAECToObesity = createMapToDomain({min: 0, max: 3}, {min: 0, max: 6});

const predictObesity = ({eatBetweenMeals}: {eatBetweenMeals: number}) =>
    // Dumb approximation by loosely mapping between the domain.
    Effect.succeed(mapCAECToObesity(eatBetweenMeals) + 2).pipe(Effect.delay(5));

void CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: await createTestCases(),
        program: predictObesity,
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 10,
});
