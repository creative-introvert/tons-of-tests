import * as Sqlite from '@effect/sql-sqlite-node';
import {Context, Layer} from 'effect';

import {makeTestRepository} from './internal/Test.repository.sqlite.js';
import type {TestRepositoryShape} from './Test.repository.types.js';

export {TestRun} from './Test.repository.types.js';
export type {
    TestRepositoryShape,
    TestResultRead,
    TestResultSchemas,
    TestRunResults,
} from './Test.repository.types.js';

const makeTestLayer = () =>
    Layer.provideMerge(
        TestRepository.Live,
        Sqlite.SqliteClient.layer({filename: ':memory:'}),
    );

let testLayerCache: ReturnType<typeof makeTestLayer> | undefined;

export class TestRepository extends Context.Tag('TestRepository')<
    TestRepository,
    TestRepositoryShape
>() {
    // Lazy getters: makeTestRepository lives in an internal module that has
    // its own import edge back here, so we evaluate these at access time
    // rather than at class definition time to avoid the circular init order.
    static get Live() {
        return Layer.effect(this, makeTestRepository);
    }
    static layer(dbPath: string) {
        return Layer.provide(
            this.Live,
            Sqlite.SqliteClient.layer({filename: dbPath}),
        );
    }

    static get TestLayer() {
        return (testLayerCache ??= makeTestLayer());
    }
}
