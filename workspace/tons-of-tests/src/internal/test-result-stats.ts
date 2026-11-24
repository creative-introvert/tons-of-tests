import {Array as A, Effect, Option, Schema} from 'effect';
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
                const counts = new Map(Object.entries(Stats.empty().counts));
                const add: Collector['add'] = Effect.fnUntraced(
                    function* (results) {
                        for (
                            let offset = 0;
                            offset < results.length;
                            offset += 50
                        ) {
                            const batch = results.slice(offset, offset + 50);
                            if (!A.isReadonlyArrayNonEmpty(batch)) break;
                            const caseTimes = A.map(
                                batch,
                                ({hashTestCase, timeMillis}) => ({
                                    hashTestCase,
                                    timeMillis,
                                }),
                            );
                            yield* sql`
                            INSERT INTO ${sql(name)} ${sql.insert(caseTimes)}
                            ON CONFLICT(hashTestCase) DO NOTHING;
                        `;
                            for (const result of batch) {
                                counts.set(
                                    result.label,
                                    (counts.get(result.label) ?? 0) + 1,
                                );
                            }
                        }
                    },
                );
                const stats = Effect.gen(function* () {
                    const totals = Object.fromEntries(counts);
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
                        counts: totals,
                        total: Object.values(totals).reduce(
                            (sum, n) => sum + n,
                            0,
                        ),
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
