import * as PT from '@creative-introvert/tons-of-tests';
import {Command, Flag} from 'effect/cli';
import {Effect, Option, Schema, Stdio, Stream} from 'effect';

import type {AppConfigShape} from './Config.js';
import {variant} from './common.js';

export const runs = <
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
        'runs',
        {
            variant,
            limit: Flag.Int('limit').pipe(
                Flag.withSchema(
                    Schema.Int.check(
                        Schema.isBetween({minimum: 1, maximum: 100}),
                    ),
                ),
                Flag.withDefault(50),
                Flag.withDescription(
                    'Show 1 to 100 saved attempts (default 50).',
                ),
            ),
            before: Flag.Int('before').pipe(
                Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
                Flag.optional,
                Flag.withDescription(
                    'Show the next page of attempts with IDs below this value.',
                ),
            ),
        },
        ({variant, limit, before}) =>
            Effect.gen(function* () {
                const repository = yield* PT.TestRepository.TestRepository;
                const attempts = yield* repository.listTestRuns({
                    name: config.testSuite.name,
                    ...(Option.isSome(variant) ? {variant: variant.value} : {}),
                    ...(Option.isSome(before) ? {before: before.value} : {}),
                    limit,
                });
                const stdio = yield* Stdio.Stdio;
                yield* Stream.succeed(
                    [
                        `Saved runs for ${config.testSuite.name}`,
                        'Run\tVariant\tState\tBaseline',
                        ...attempts.map(
                            run =>
                                `run:${run.id}\t${run.variant}\t${run.state}\t${run.isBaseline ? 'yes' : ''}`,
                        ),
                        '',
                    ].join('\n'),
                ).pipe(Stream.run(stdio.stdout()));
            }),
    ).pipe(
        Command.withDescription(
            'List saved attempts in descending ID order, including failed and running attempts.',
        ),
    );
