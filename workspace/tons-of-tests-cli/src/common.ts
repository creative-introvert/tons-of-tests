import * as PT from '@creative-introvert/tons-of-tests';
import {Flag} from 'effect/cli';
import {Effect, Option} from 'effect';

export const cached = Flag.Boolean('cached').pipe(Flag.withDefault(false));

export const getPreviousTestRunResults = <
    I = unknown,
    O = unknown,
    T = unknown,
    E = never,
    R = never,
>(
    testSuite: PT.Test.TestSuite<I, O, T, E, R>,
): Effect.Effect<
    Option.Option<PT.Test.TestRunResults<I, O, T>>,
    PT.Error.RepositoryError,
    PT.TestRepository.TestRepository
> =>
    Effect.gen(function* () {
        const repo = yield* PT.TestRepository.TestRepository;
        const maybeRun = yield* repo.getPreviousTestRun(testSuite.name);
        if (Option.isNone(maybeRun)) return Option.none();
        const run = yield* repo
            .getTestResultsStream<I, O, T>(maybeRun.value, testSuite.schemas)
            .pipe(PT.Test.runCollectRecord(maybeRun.value));
        return Option.some(run);
    });
