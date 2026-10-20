import {Effect, Option, Ref, Schema} from 'effect';
import {SqlClient} from 'effect/sql';

import {Stats} from '../Classify.js';
import type {TestRepositoryShape} from '../Test.repository.js';
import {precision, recall} from './Classify.js';

const decodeName = Schema.decodeUnknownEffect(
    Schema.Tuple([Schema.Struct({name: Schema.String})]),
);
const decodeTimes = Schema.decodeUnknownEffect(
    Schema.Tuple([
        Schema.Struct({
            count: Schema.Int,
            mean: Schema.NullOr(Schema.Finite),
            min: Schema.NullOr(Schema.Finite),
            max: Schema.NullOr(Schema.Finite),
        }),
    ]),
);
const decodeMedian = Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({timeMillis: Schema.Finite})),
);
type Collector = Parameters<Parameters<TestRepositoryShape['withStats']>[0]>[0];

export const withStats = Effect.fnUntraced(function* <A, E, R>(
    use: (collector: Collector) => Effect.Effect<A, E, R>,
) {
    const sql = yield* SqlClient.SqlClient;
    const [{name}] = yield* decodeName(
        yield* sql`SELECT 'tots_stats_' || lower(hex(randomblob(16))) AS name;`,
    );
    return yield* Effect.acquireUseRelease(
        sql`CREATE TEMP TABLE ${sql(name)} (hashTestCase TEXT PRIMARY KEY, timeMillis REAL NOT NULL);`,
        () =>
            Effect.gen(function* () {
                yield* sql`CREATE INDEX ${sql(`${name}_time`)} ON ${sql(name)} (timeMillis);`;
                const counts = yield* Ref.make({
                    TP: 0,
                    TN: 0,
                    FP: 0,
                    FN: 0,
                    total: 0,
                });
                const add: Collector['add'] = Effect.fnUntraced(
                    function* (results) {
                        for (
                            let offset = 0;
                            offset < results.length;
                            offset += 50
                        ) {
                            const batch = results.slice(offset, offset + 50);
                            yield* sql`
                            INSERT INTO ${sql(name)} ${sql.insert(batch.map(({hashTestCase, timeMillis}) => ({hashTestCase, timeMillis})))}
                            ON CONFLICT(hashTestCase) DO NOTHING;
                        `;
                            yield* Ref.update(counts, previous => {
                                const next = {...previous};
                                for (const result of batch) {
                                    next[result.label]++;
                                    next.total++;
                                }
                                return next;
                            });
                        }
                    },
                );
                const stats = Effect.gen(function* () {
                    const totals = yield* Ref.get(counts);
                    const [times] = yield* decodeTimes(
                        yield* sql`
                        SELECT COUNT(*) AS count, AVG(timeMillis) AS mean,
                            MIN(timeMillis) AS min, MAX(timeMillis) AS max FROM ${sql(name)};
                    `,
                    );
                    const middle =
                        times.count === 0
                            ? []
                            : yield* decodeMedian(
                                  yield* sql`
                        SELECT timeMillis FROM ${sql(name)} ORDER BY timeMillis
                        LIMIT ${2 - (times.count % 2)} OFFSET ${Math.floor((times.count - 1) / 2)};
                    `,
                              );
                    return new Stats({
                        ...totals,
                        testCases: times.count,
                        precision: precision(totals),
                        recall: recall(totals),
                        timeMin: Option.fromNullishOr(times.min),
                        timeMax: Option.fromNullishOr(times.max),
                        timeMean: Option.fromNullishOr(times.mean),
                        timeMedian:
                            middle.length === 0
                                ? Option.none()
                                : Option.some(
                                      middle.reduce(
                                          (sum, row) => sum + row.timeMillis,
                                          0,
                                      ) / middle.length,
                                  ),
                    });
                });
                return yield* use({add, stats});
            }),
        () => sql`DROP TABLE ${sql(name)};`.pipe(Effect.asVoid),
    );
});
