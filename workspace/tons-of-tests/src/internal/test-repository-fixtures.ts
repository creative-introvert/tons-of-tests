import {Effect, Schema} from 'effect';
import {SqlClient} from 'effect/sql';

import {TestRun} from '../TestRun.js';
import {TestResultStorage, tables} from './Test.repository.sqlite.js';

// Tests inspect storage directly; these operations are not part of TestRepository.
export const getAllTestRuns = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Schema.decodeUnknownEffect(Schema.Array(TestRun))(
        yield* sql`SELECT * FROM ${sql(tables.testRuns)};`,
    );
});

export const getAllTestResults = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Schema.decodeUnknownEffect(Schema.Array(TestResultStorage))(
        yield* sql`SELECT * FROM ${sql(tables.testResults)};`,
    );
});

export const getAllTestRunResults = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* Schema.decodeUnknownEffect(
        Schema.Array(
            Schema.Struct({
                testRun: Schema.Int,
                testResult: Schema.String,
                ordering: Schema.Int,
                resultOrdering: Schema.Int,
                timeMillis: Schema.Finite,
                tags: Schema.fromJsonString(Schema.Array(Schema.String)),
            }),
        ),
    )(yield* sql`SELECT * FROM ${sql(tables.testRunResults)};`);
});
