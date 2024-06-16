import type {SqlError} from '@effect/sql/Error';
import {Options} from '@effect/cli';
import * as PT from '@creative-introvert/tons-of-tests';

import * as P from './prelude.js';

export const cached = Options.boolean('cached').pipe(
    Options.withDefault(false),
);

export const getPreviousTestRunResults = <
    I = unknown,
    O = unknown,
    T = unknown,
>(
    testSuite: PT.Test.TestSuite<I, O, T>,
): P.Effect.Effect<
    P.Option.Option<PT.Test.TestRunResults>,
    SqlError | P.Result.ParseError,
    PT.TestRepository.TestRepository
> =>
    P.Effect.gen(function* () {
        const repository = yield* PT.TestRepository.TestRepository;
        return yield* repository.getPreviousTestRun(testSuite.name).pipe(
            P.Effect.flatMap(
                P.Option.match({
                    onNone: () => P.Effect.succeed(P.Option.none()),
                    onSome: testRun =>
                        repository
                            .getTestResultsStream(testRun)
                            .pipe(
                                PT.Test.runCollectRecord(testRun),
                                P.Effect.map(P.Option.some),
                            ),
                }),
            ),
        );
    });

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export const isNotUndefined = <T>(a: T | undefined | void): a is T => a !== undefined;
