import {Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';
import type { SqlError } from '@effect/sql/SqlError';
import type { ParseError } from 'effect/ParseResult';
import { Effect, Option } from 'effect';

export const cached = Options.boolean('cached').pipe(
    Options.withDefault(false),
);

export const getPreviousTestRunResults = <
    I = unknown,
    O = unknown,
    T = unknown,
>(
    testSuite: PT.Test.TestSuite<I, O, T>,
): Effect.Effect<
    Option.Option<PT.Test.TestRunResults>,
    SqlError | ParseError,
    PT.TestRepository.TestRepository
> =>
    Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        return yield* repository.getPreviousTestRun(testSuite.name).pipe(
            Effect.flatMap(
                Option.match({
                    onNone: () => Effect.succeed(Option.none()),
                    onSome: testRun =>
                        repository
                            .getTestResultsStream(testRun)
                            .pipe(
                                PT.Test.runCollectRecord(testRun),
                                Effect.map(Option.some),
                            ),
                }),
            ),
        );
    });
