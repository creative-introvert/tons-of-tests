import * as PT from '@creative-introvert/tons-of-tests';
import {NodeRuntime} from '@effect/platform-node';
import {
    Cause,
    Console,
    Effect,
    Exit,
    FileSystem,
    Option,
    Path,
    PlatformError,
    Schema,
    Stream,
} from 'effect';

import * as CLI from '../index.js';

const Request = Schema.fromJsonString(
    Schema.Struct({
        directory: Schema.String,
        dbPath: Schema.String,
        cachePath: Schema.optional(Schema.String),
        mode: Schema.Literals([
            'normal',
            'forbid-execution',
            'fail-B',
            'report-failure',
        ]),
        offset: Schema.Finite,
        commands: Schema.Array(Schema.Array(Schema.String)),
        readBaseline: Schema.Boolean,
    }),
);

const main = Effect.gen(function* () {
    const request = yield* Schema.decodeEffect(Request)(process.argv[2]);
    process.chdir(request.directory);
    const program = (variant: 'A' | 'B') => (input: number) =>
        Effect.gen(function* () {
            if (request.mode === 'forbid-execution') {
                return yield* Effect.fail({
                    _tag: 'UnexpectedExecution',
                } as const);
            }
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            yield* fs.writeFileString(
                path.join(request.directory, 'executions.txt'),
                `${variant}:${input}\n`,
                {flag: 'a'},
            );
            if (request.mode === 'fail-B' && variant === 'B') {
                return yield* Effect.fail({
                    _tag: 'FixtureExecutionFailure',
                } as const);
            }
            return input + request.offset + (variant === 'B' ? 100 : 0);
        });
    const config = {
        dbPath: request.dbPath,
        ...(request.cachePath === undefined
            ? {}
            : {cachePath: request.cachePath}),
        concurrency: 1,
        testSuite: {
            name: 'cache-lifecycle',
            schemas: {
                testCase: {input: Schema.Finite, expected: Schema.Finite},
                evaluation: {result: Schema.Finite, expected: Schema.Finite},
            },
            testCases: [1, 2, 3].map(input => ({
                input,
                expected: input,
                tags: input === 1 ? ['keep'] : ['other'],
            })),
            variants: {
                A: {program: program('A')},
                B: {program: program('B')},
            },
        },
    };
    const state = yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const commands: Array<{error: string | null; count: number | null}> =
            [];
        for (const args of request.commands) {
            const command = CLI.effectNoDeps(config, [
                'node',
                'fixture',
                ...args,
            ]);
            const exit = yield* Effect.exit(
                request.mode === 'report-failure'
                    ? command.pipe(
                          Effect.provideService(FileSystem.FileSystem, {
                              ...fs,
                              makeTempFileScoped: () =>
                                  Effect.fail(
                                      PlatformError.systemError({
                                          _tag: 'Unknown',
                                          module: 'FileSystem',
                                          method: 'makeTempFileScoped',
                                      }),
                                  ),
                          }),
                      )
                    : command,
            );
            if (Exit.isFailure(exit)) {
                const error = Option.getOrUndefined(
                    Cause.findErrorOption(exit.cause),
                );
                commands.push({
                    error: error?._tag ?? 'Defect',
                    count: error?._tag === 'DiffNonEmpty' ? error.count : null,
                });
                break;
            }
            commands.push({error: null, count: null});
        }
        const repository = yield* PT.TestRepository.TestRepository;
        const results = (run: PT.TestRepository.TestRun) =>
            repository
                .getTestResultsStream(run, config.testSuite.schemas)
                .pipe(Stream.runCollect);
        const cache = yield* Effect.forEach(['A', 'B'], variant =>
            Effect.gen(function* () {
                const run = yield* repository.getLatestTestRun({
                    name: config.testSuite.name,
                    variant,
                });
                return Option.isSome(run)
                    ? {run: run.value, results: yield* results(run.value)}
                    : null;
            }),
        );
        const baselines = yield* Effect.forEach(['A', 'B'], variant =>
            repository
                .getBaselineTestRun({name: config.testSuite.name, variant})
                .pipe(Effect.map(Option.getOrNull)),
        );
        const snapshots = yield* Effect.forEach(
            yield* repository.listTestRuns({
                name: config.testSuite.name,
                limit: 100,
            }),
            run =>
                Effect.gen(function* () {
                    return {
                        run,
                        isBaseline: run.isBaseline,
                        results: yield* results(run),
                    };
                }),
        );
        return {commands, cache, baselines, snapshots};
    }).pipe(Effect.provide(CLI.buildLayer(config)));
    const baseline = request.readBaseline
        ? yield* Effect.promise(() => CLI.getBaselineRun(config, 'A'))
        : null;
    yield* Console.log(
        `\nCACHE_LIFECYCLE_RESULT=${JSON.stringify({...state, baseline})}`,
    );
    if (state.commands.some(command => command.error !== null)) {
        process.exitCode = 1;
    }
});

main.pipe(NodeRuntime.runMain);
