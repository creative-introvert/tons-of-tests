import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {
    Effect,
    Option,
    Schema,
    SchemaTransformation,
    Stdio,
    Stream,
} from 'effect';

import type {AppConfigShape} from './Config.js';
import {
    InvalidCommandOptions,
    matchesFilters,
    resultFilterFlags,
    RunReference,
    variant,
    type ResultFilters,
} from './common.js';
import {executeRun, resolveRun, selectVariants} from './test-run.js';

const RunReferences = Schema.String.pipe(
    Schema.decodeTo(
        Schema.Array(RunReference).check(Schema.isNonEmpty()),
        SchemaTransformation.transform({
            decode: (value): readonly string[] => value.split(','),
            encode: values => values.join(','),
        }),
    ),
);

export const summarizeRuns = Effect.fn('Stats.runs')(function* <
    I,
    O,
    T,
    A,
    B,
    S,
>({
    config,
    references,
    cached = false,
    variant,
    ...filters
}: ResultFilters & {
    config: AppConfigShape<I, O, T, A, B, S>;
    references?: readonly RunReference[] | undefined;
    cached?: boolean | undefined;
    variant?: string | undefined;
}) {
    const {testSuite} = config;
    const configured =
        testSuite.variants === undefined
            ? ['default']
            : Object.keys(testSuite.variants);
    if (references !== undefined) {
        return yield* Effect.forEach(
            references,
            reference =>
                Effect.gen(function* () {
                    const run = yield* resolveRun(testSuite.name, reference);
                    const summary = yield* PT.Test.summarizeRun({
                        run,
                        schemas: testSuite.schemas,
                        predicate: result => matchesFilters(result, filters),
                    });
                    return {
                        name: run.name,
                        variant: run.variant,
                        run: Option.some(run),
                        stats: Option.some(summary.stats),
                        source: 'snapshot' as const,
                        retired:
                            run.name === testSuite.name &&
                            !configured.includes(run.variant),
                    };
                }),
            {concurrency: 1},
        );
    }
    const variants = yield* selectVariants<I, O, T, A, B, S>(
        testSuite,
        variant,
    );
    return yield* Effect.forEach(
        variants,
        variant =>
            Effect.gen(function* () {
                const selected = yield* executeRun<I, O, T, A, B, S>({
                    config,
                    cached,
                    variant,
                });
                const summary = yield* PT.Test.summarizeRun({
                    run: selected.run,
                    schemas: testSuite.schemas,
                    predicate: result => matchesFilters(result, filters),
                });
                return {
                    name: selected.run.name,
                    variant,
                    run: Option.some(selected.run),
                    stats: Option.some(summary.stats),
                    source: selected.source,
                    retired: false,
                };
            }),
        {concurrency: 1},
    );
});

export const stats = <
    I = unknown,
    O = unknown,
    T = unknown,
    A = O,
    B = T,
    S = never,
>(
    config: AppConfigShape<I, O, T, A, B, S>,
) =>
    Command.make(
        'stats',
        {
            variant,
            cached: Flag.Boolean('cached').pipe(
                Flag.optional,
                Flag.withDescription(
                    'Reuse each variant’s latest cached attempt if complete, even after code changes. Rerun missing, running, or failed attempts.',
                ),
            ),
            runs: Flag.String('runs').pipe(
                Flag.withSchema(RunReferences),
                Flag.optional,
                Flag.withDescription(
                    'Read saved variant baselines or run:<id> snapshots in display order, separated by commas. Runs no programs; cannot be combined with --variant or --cached.',
                ),
            ),
            ...resultFilterFlags,
        },
        ({runs, variant, cached, ...filters}) =>
            Effect.gen(function* () {
                if (
                    Option.isSome(runs) &&
                    (Option.isSome(variant) || Option.isSome(cached))
                ) {
                    return yield* new InvalidCommandOptions({
                        message:
                            '--runs cannot be combined with --variant or --cached.',
                    });
                }
                const summaries = yield* summarizeRuns<I, O, T, A, B, S>({
                    config,
                    references: Option.getOrUndefined(runs),
                    variant: Option.getOrUndefined(variant),
                    cached: Option.getOrElse(cached, () => false),
                    ...filters,
                });
                const stdio = yield* Stdio.Stdio;
                yield* Stream.succeed(
                    `${PT.Show.runSummaries({summaries, displayConfig: config.displayConfig})}\n`,
                ).pipe(Stream.run(stdio.stdout()));
            }),
    ).pipe(
        Command.withDescription(
            'Run all configured variants and show one statistics row per variant. Count all filtered results, including unchanged ones. Use --cached to reuse results, or --runs to read committed snapshots without running programs.',
        ),
    );
