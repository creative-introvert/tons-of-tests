import * as t from '@effect/vitest';
import * as PT from '@creative-introvert/tons-of-tests';
import {Context, Effect, FileSystem, Option, Ref, Schema, Stream} from 'effect';
import {NodeServices} from '@effect/platform-node';
import type {PlatformError} from 'effect/PlatformError';
import type {CliError} from 'effect/cli/CliError';

import type {InvalidCommandOptions} from './common.js';
import {DiffNonEmpty} from './diff.js';
import {
    buildLayer,
    effect as cliEffect,
    getBaselineRun,
    type Config,
} from './index.js';

const numberSchemas = {
    testCase: {input: Schema.Finite, expected: Schema.Finite},
    evaluation: {result: Schema.Finite, expected: Schema.Finite},
};

class Multiplier extends Context.Service<
    Multiplier,
    {
        readonly value: number;
        readonly hits: Ref.Ref<number>;
    }
>()('Multiplier') {}

t.describe('CLI.effect', () => {
    t.it.effect.each([
        {
            description:
                'runs the selected subcommand with array test cases and caller-provided dependencies',
            args: ['node', 'test', 'summarize'] as const,
            testCases: [
                {input: 1, expected: 3},
                {input: 2, expected: 4},
            ],
            expectedHits: 2,
        },
        {
            description:
                'runs the selected subcommand with stream test cases and caller-provided dependencies',
            args: ['node', 'test', 'summarize'] as const,
            testCases: Stream.fromIterable([
                {input: 1, expected: 3},
                {input: 2, expected: 4},
            ]),
            expectedHits: 2,
        },
    ])('$description', ({args, testCases, expectedHits}) =>
        Effect.gen(function* () {
            const hits = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                cachePath: ':memory:',
                testSuite: {
                    name: 'cli-effect-deps',
                    schemas: numberSchemas,
                    testCases,
                    program: (input: number) =>
                        Effect.gen(function* () {
                            const multiplier = yield* Multiplier;
                            yield* Ref.update(multiplier.hits, _ => _ + 1);
                            return input + multiplier.value;
                        }),
                },
            };

            yield* cliEffect(config, args).pipe(
                Effect.provideService(Multiplier, {value: 2, hits}),
            );

            t.expect(yield* Ref.get(hits)).toBe(expectedHits);
        }),
    );

    t.it.effect.each([
        {
            description: 'accepts any listed result key',
            input: ['--keys', 'budget,need'],
            expectedCount: 4,
        },
        {
            description: 'combines key, label, and case tag filters',
            input: [
                '--keys',
                'budget,need',
                '--labels',
                'FP',
                '--tags',
                'enterprise,missing',
                '--all-tags',
                'enterprise,de',
            ],
            expectedCount: 1,
        },
        {
            description: 'requires every tag in --all-tags',
            input: ['--tags', 'enterprise,smb', '--all-tags', 'enterprise,de'],
            expectedCount: 2,
        },
        {
            description: 'accepts any listed label',
            input: ['--keys', 'budget', '--labels', 'FP,TP'],
            expectedCount: 2,
        },
        {
            description: 'succeeds when no result key matches',
            input: ['--keys', 'missing'],
            expectedCount: 0,
        },
    ])('diff $description', ({input, expectedCount}) =>
        Effect.gen(function* () {
            const expected = {budget: 100, need: 2};
            const classify = PT.Classify.makeClassify({
                isEqual: Schema.toEquivalence(Schema.Finite),
            });
            const config = {
                dbPath: ':memory:',
                cachePath: ':memory:',
                testSuite: {
                    name: 'cli-result-filters',
                    schemas: {
                        testCase: {
                            input: Schema.String,
                            expected: Schema.Struct({
                                budget: Schema.Finite,
                                need: Schema.Finite,
                            }),
                        },
                        evaluation: numberSchemas.evaluation,
                    },
                    testCases: [
                        {input: 'call-1', expected, tags: ['enterprise', 'de']},
                        {input: 'call-2', expected, tags: ['smb', 'de']},
                    ],
                    program: (_: string) =>
                        Effect.succeed({budget: 80, need: 2}),
                    evaluate: (
                        result: typeof expected,
                        target: typeof expected,
                    ) =>
                        [
                            {
                                key: 'budget',
                                result: result.budget,
                                expected: target.budget,
                                label: classify(result.budget, target.budget),
                            },
                            {
                                key: 'need',
                                result: result.need,
                                expected: target.need,
                                label: classify(result.need, target.need),
                            },
                        ] as const,
                },
            };

            const count = yield* cliEffect(config, [
                'node',
                'test',
                'diff',
                '--exit-on-diff',
                ...input,
            ]).pipe(
                Effect.catchTag('DiffNonEmpty', error =>
                    Effect.succeed(error.count),
                ),
                Effect.map(count => count ?? 0),
            );
            t.expect(count).toBe(expectedCount);
        }),
    );

    t.it.effect.each([
        {
            description: 'keeps DiffNonEmpty in the error channel',
            args: ['node', 'test', 'diff', '--exit-on-diff'] as const,
        },
    ])('$description', ({args}) =>
        Effect.gen(function* () {
            const config = {
                dbPath: ':memory:',
                cachePath: ':memory:',
                testSuite: {
                    name: 'cli-effect-diff-non-empty',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 2}],
                    program: (input: number) => Effect.succeed(input + 1),
                },
            };

            const err = yield* Effect.flip(cliEffect(config, args));
            t.expect(err).toBeInstanceOf(DiffNonEmpty);
        }),
    );

    t.it.effect.each([
        {description: 'unknown label', input: ['--labels', 'invalid']},
        {description: 'empty label', input: ['--labels', '']},
        {description: 'missing label value', input: ['--labels']},
    ])('rejects $description before running tests', ({input}) =>
        Effect.gen(function* () {
            const hits = yield* Ref.make(0);
            const config = {
                dbPath: ':memory:',
                cachePath: ':memory:',
                testSuite: {
                    name: 'invalid-cli-labels',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    program: (n: number) =>
                        Ref.update(hits, n => n + 1).pipe(Effect.as(n)),
                },
            };
            const error = yield* Effect.flip(
                cliEffect(config, ['node', 'test', 'summarize', ...input]),
            );
            t.expect(error._tag).toBe('ShowHelp');
            t.expect(yield* Ref.get(hits)).toBe(0);
        }),
    );
});

t.it.effect(
    'getBaselineRun reads the selected baseline or null through a new connection',
    () =>
        Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const directory = yield* fs.makeTempDirectoryScoped();
            const config = {
                dbPath: `${directory}/baselines.db`,
                cachePath: `${directory}/cache.sqlite`,
                testSuite: {
                    name: 'baseline-helper',
                    schemas: numberSchemas,
                    testCases: [{input: 1, expected: 1}],
                    variants: {
                        A: {program: (input: number) => Effect.succeed(input)},
                        B: {program: (input: number) => Effect.succeed(input)},
                    },
                },
            };
            const before = yield* Effect.promise(() =>
                getBaselineRun(config, 'A'),
            );
            t.expect(yield* fs.exists(config.dbPath)).toBe(false);
            yield* cliEffect(config, [
                'node',
                'suite',
                'summarize',
                '--variant',
                'A',
            ]);
            yield* cliEffect(config, [
                'node',
                'suite',
                'commit',
                '--variant',
                'A',
            ]);
            const after = yield* Effect.promise(() =>
                getBaselineRun(config, 'A'),
            );
            const other = yield* Effect.promise(() =>
                getBaselineRun(config, 'B'),
            );
            t.expect({
                before,
                other,
                selected: after && {
                    id: after.id,
                    name: after.name,
                    variant: after.variant,
                    state: after.state,
                },
            }).toEqual({
                before: null,
                other: null,
                selected: {
                    id: 1,
                    name: 'baseline-helper',
                    variant: 'A',
                    state: 'Complete',
                },
            });
        }).pipe(Effect.provide(NodeServices.layer)),
);

t.it.effect.each([
    'same path',
    'normalized path',
    'symbolic link',
    'hard link',
    'directory link',
    'dangling link',
] as const)('rejects a cache that aliases its snapshot through %s', alias =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const dbPath = `${directory}/snapshot.sqlite`;
        const saved = 'The snapshot must remain unchanged.';
        if (alias !== 'dangling link') yield* fs.writeFileString(dbPath, saved);
        let cachePath = dbPath;
        if (alias === 'normalized path')
            cachePath = `${directory}/nested/../snapshot.sqlite`;
        if (alias === 'symbolic link' || alias === 'dangling link') {
            cachePath = `${directory}/alias.sqlite`;
            yield* fs.symlink(dbPath, cachePath);
        }
        if (alias === 'hard link') {
            cachePath = `${directory}/alias.sqlite`;
            yield* fs.link(dbPath, cachePath);
        }
        if (alias === 'directory link') {
            yield* fs.symlink(directory, `${directory}/alias`);
            cachePath = `${directory}/alias/snapshot.sqlite`;
        }
        const config = {
            dbPath,
            cachePath,
            testSuite: {
                name: 'same-file',
                schemas: numberSchemas,
                testCases: [{input: 1, expected: 1}],
                program: () =>
                    Effect.die('Path validation must happen before execution.'),
            },
        };
        const error = yield* cliEffect(config, [
            'node',
            'suite',
            'summarize',
        ]).pipe(Effect.flip);
        t.expect(error._tag).toBe('RepositoryPathConflict');
        t.expect(
            alias === 'dangling link'
                ? yield* fs.exists(dbPath)
                : yield* fs.readFileString(dbPath),
        ).toEqual(alias === 'dangling link' ? false : saved);
        t.expect(yield* fs.exists(`${dbPath}-wal`)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
);

t.it.effect('isolates snapshot paths and suites within one cache file', () =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const executions: string[] = [];
        const configure = (snapshot: string, name: string, result: number) => ({
            dbPath: `${directory}/${snapshot}.sqlite`,
            cachePath: `${directory}/shared-cache.sqlite`,
            testSuite: {
                name,
                schemas: numberSchemas,
                testCases: [{input: 0, expected: 0}],
                program: () =>
                    Effect.sync(() => {
                        executions.push(`${snapshot}/${name}`);
                        return result;
                    }),
            },
        });
        const configurations = [
            configure('first', 'suite', 1),
            configure('second', 'suite', 2),
            configure('first', 'other-suite', 3),
        ];
        for (const config of configurations) {
            yield* cliEffect(config, [
                'node',
                'suite',
                'summarize',
                '--cached',
            ]);
        }
        const results = [];
        for (const config of configurations) {
            yield* cliEffect(config, ['node', 'suite', 'stats', '--cached']);
            const result = yield* Effect.gen(function* () {
                const repository = yield* PT.TestRepository.TestRepository;
                const run = yield* repository.getLatestTestRun({
                    name: config.testSuite.name,
                    variant: 'default',
                });
                return yield* repository
                    .getTestResultsStream(
                        Option.getOrThrow(run),
                        config.testSuite.schemas,
                    )
                    .pipe(Stream.runCollect);
            }).pipe(Effect.provide(buildLayer(config)));
            results.push(result.map(row => row.result));
            t.expect(yield* fs.exists(config.dbPath)).toBe(false);
        }
        t.expect({executions, results}).toEqual({
            executions: ['first/suite', 'second/suite', 'first/other-suite'],
            results: [[1], [2], [3]],
        });
    }).pipe(Effect.provide(NodeServices.layer)),
);

class ProgramA extends Context.Service<ProgramA, {readonly value: number}>()(
    'ProgramA',
) {}
class ProgramB extends Context.Service<ProgramB, {readonly value: number}>()(
    'ProgramB',
) {}
class Cases extends Context.Service<Cases, {readonly value: number}>()(
    'Cases',
) {}

const failureA = {_tag: 'FailureA'} as const;
const failureB = {_tag: 'FailureB'} as const;
const failureCases = {_tag: 'FailureCases'} as const;
const typedCases = Stream.fromEffect(
    Effect.gen(function* () {
        const cases = yield* Cases;
        if (cases.value < 0) return yield* Effect.fail(failureCases);
        return {input: cases.value, expected: cases.value};
    }),
);
const programA = (input: number) =>
    Effect.gen(function* () {
        const service = yield* ProgramA;
        if (input < 0) return yield* Effect.fail(failureA);
        return input + service.value;
    });
const programB = (input: number) =>
    Effect.gen(function* () {
        const service = yield* ProgramB;
        if (input < 0) return yield* Effect.fail(failureB);
        return input + service.value;
    });
type LibraryError =
    | DiffNonEmpty
    | InvalidCommandOptions
    | PlatformError
    | PT.Test.TestVariantNotFound
    | PT.Test.TestVariantRequired
    | CliError
    | PT.Error.RepositoryError;
t.it(
    'preserves all program and case-stream channels in inline CLI suites',
    () => {
        const annotated: Config<number, number, number> = {
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'annotated',
                schemas: numberSchemas,
                testCases: [{input: 1, expected: 1}],
                program: (input: number) => Effect.succeed(input),
            },
        };
        const annotatedEffect = cliEffect(annotated);
        t.expectTypeOf<
            Effect.Services<typeof annotatedEffect>
        >().toEqualTypeOf<never>();
        const defaultVariants = cliEffect(
            {
                dbPath: ':memory:',
                cachePath: ':memory:',
                testSuite: {
                    name: 'typed-default-variants',
                    schemas: numberSchemas,
                    testCases: typedCases,
                    variants: {A: {program: programA}, B: {program: programB}},
                },
            },
            ['node', 'suite', 'summarize', '--variant', 'A'],
        );
        const customVariants = cliEffect({
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'typed-custom-variants',
                schemas: numberSchemas,
                testCases: typedCases,
                variants: {
                    A: {
                        program: (input: number) =>
                            programA(input).pipe(
                                Effect.map(answer => ({
                                    answer,
                                    read: () => answer,
                                })),
                            ),
                    },
                    B: {
                        program: (input: number) =>
                            programB(input).pipe(
                                Effect.map(answer => ({
                                    answer,
                                    read: () => answer,
                                })),
                            ),
                    },
                },
                evaluate: (output, expected) => [
                    {
                        key: 'answer',
                        result: output.answer,
                        expected,
                        label: 'TP',
                    },
                ],
            },
        });
        const defaultSingle = cliEffect({
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'typed-default-single',
                schemas: numberSchemas,
                testCases: typedCases,
                program: programA,
            },
        });
        const customSingle = cliEffect({
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'typed-custom-single',
                schemas: numberSchemas,
                testCases: typedCases,
                program: (input: number) =>
                    programA(input).pipe(Effect.map(answer => ({answer}))),
                evaluate: (output, expected) => [
                    {
                        key: 'answer',
                        result: output.answer,
                        expected,
                        label: 'TP',
                    },
                ],
            },
        });
        const emptyDefault = cliEffect({
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'typed-empty-default',
                schemas: numberSchemas,
                testCases: typedCases,
                variants: {},
            },
        });
        const emptyCustom = cliEffect({
            dbPath: ':memory:',
            cachePath: ':memory:',
            testSuite: {
                name: 'typed-empty-custom',
                schemas: numberSchemas,
                testCases: typedCases,
                variants: {},
                evaluate: (output: number, expected) => [
                    {key: 'answer', result: output, expected, label: 'TP'},
                ],
            },
        });
        type Failures = typeof failureA | typeof failureB | typeof failureCases;
        t.expectTypeOf<Effect.Error<typeof defaultVariants>>().toEqualTypeOf<
            LibraryError | Failures
        >();
        t.expectTypeOf<Effect.Services<typeof defaultVariants>>().toEqualTypeOf<
            ProgramA | ProgramB | Cases
        >();
        t.expectTypeOf<Effect.Error<typeof customVariants>>().toEqualTypeOf<
            LibraryError | Failures
        >();
        t.expectTypeOf<Effect.Services<typeof customVariants>>().toEqualTypeOf<
            ProgramA | ProgramB | Cases
        >();
        t.expectTypeOf<Effect.Error<typeof defaultSingle>>().toEqualTypeOf<
            LibraryError | typeof failureA | typeof failureCases
        >();
        t.expectTypeOf<Effect.Services<typeof defaultSingle>>().toEqualTypeOf<
            ProgramA | Cases
        >();
        t.expectTypeOf<Effect.Error<typeof customSingle>>().toEqualTypeOf<
            LibraryError | typeof failureA | typeof failureCases
        >();
        t.expectTypeOf<Effect.Services<typeof customSingle>>().toEqualTypeOf<
            ProgramA | Cases
        >();
        t.expectTypeOf<Effect.Error<typeof emptyDefault>>().toEqualTypeOf<
            LibraryError | typeof failureCases
        >();
        t.expectTypeOf<
            Effect.Services<typeof emptyDefault>
        >().toEqualTypeOf<Cases>();
        t.expectTypeOf<Effect.Error<typeof emptyCustom>>().toEqualTypeOf<
            LibraryError | typeof failureCases
        >();
        t.expectTypeOf<
            Effect.Services<typeof emptyCustom>
        >().toEqualTypeOf<Cases>();
    },
);
