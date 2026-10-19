# Migration Guide — v1.0

## Effect 4 update

The next major release uses Effect 4 and requires Node.js 24 or newer.
Update your `effect` dependency and any `@effect/*` packages together.
The examples below use the current API names.

- `@effect/platform`, `@effect/sql`, and `@effect/cli` are now part of `effect`.
- Services use `Context.Service`. Platform services use `NodeServices.layer`.
- Cached-value schemas use `Schema.Codec<T>`. Their encoded and decoded types
  must match the values saved by the test runner.
- `RepositoryDecodeError.cause` is now `Schema.SchemaError`.
- `TestRunNotCreated.testSuiteName` replaces its old `name` payload field.
  `name` now identifies the error type.
- Statistics and timings require finite numbers.
- Explicit CLI arguments still include the Node and script names, for example
  `['node', 'suite.ts', 'summarize']`.

The SQLite driver now uses `node:sqlite`. It no longer needs `better-sqlite3`
or its native build tools. The database layout and result hashes are unchanged.

## Database compatibility

Existing SQLite DBs are readable. Schema/row layout for `testRuns`, `testResults`, and `testRunResults` is unchanged. On first connect, v1 adds new indices via `CREATE ... IF NOT EXISTS`.

Caveat: v1 creates a partial `UNIQUE INDEX idx_current_per_name ON testRuns(name) WHERE hash IS NULL`. If your existing DB contains more than one uncommitted (`hash IS NULL`) row per suite name, index creation will fail. Resolve with:

```sql
DELETE FROM testRunResults
WHERE testRun IN (
    SELECT id FROM testRuns t1
    WHERE hash IS NULL
      AND id < (SELECT MAX(id) FROM testRuns t2 WHERE t2.name = t1.name AND t2.hash IS NULL)
);
DELETE FROM testRuns t1
WHERE hash IS NULL
  AND id < (SELECT MAX(id) FROM testRuns t2 WHERE t2.name = t1.name AND t2.hash IS NULL);
```

## `@creative-introvert/tons-of-tests`

### Removed

- `Error` module — `DuplicateTestCase` is gone. The `Error` namespace now re-exports `RepositoryError`.
- `TestRepository.LiveLayer` — replaced by `TestRepository.TestRepository.Live`.
- `TestRepository.makeSqliteLiveLayer(dbPath)` — replaced by `TestRepository.TestRepository.layer(dbPath)`.
- `TestRepository.SqliteTestLayer` — replaced by `TestRepository.TestRepository.TestLayer`.

### Renamed / moved

- `TestRepository.TestRepository` is a `Context.Service` class (was `Context.GenericTag`). Access it with `yield* PT.TestRepository.TestRepository`.
- `TestRun` is now a `Schema.Class` (was a plain type). Construct with `new TestRun({id, name, hash})`.
- `Classify.Stats` is now a `Schema.Class`. Construct with `new Stats({...})` or `Stats.empty()`. The standalone `StatsSchema` export is removed (use `Stats` itself).

### Repository API changes

- `insertTestResult(input, name: string)` → `insertTestResult(input, testRun: TestRun)`. The second arg is a resolved `TestRun`, not a suite name.
- New: `insertTestResults(inputs: ReadonlyArray<TestResult>, testRun: TestRun)` for batch inserts.
- `getTestResultsStream(testRun)` now accepts an optional `schemas?: TestResultSchemas<I, O, T>` second arg and returns `Stream<TestResult<I, O, T>, RepositoryError>`.
- All repository methods now fail with `RepositoryError` (a union of `RepositoryQueryError | RepositoryWriteError | RepositoryDecodeError | TestRunNotCreated`) instead of bare `SqlError | ParseError | ResultLengthMismatch`.

### `TestSuite`

New optional field:

```ts
testSuite: {
  // ...
  schemas?: { input: Schema.Codec<I>; result: Schema.Codec<O>; expected: Schema.Codec<T> };
}
```

Required if you want typed (non-`unknown`) decoding from cached rows.

### Added

- `Test.makeSha256` is now a public export.
- `Classify.LabelSchema` is exported from the `Classify` module.

## `@creative-introvert/tons-of-tests-cli`

### `CLI.run`

- Return type `Promise<string | null>` → `void`. `run` now drives the process via `NodeRuntime.runMain` and exits.
- To get the last committed hash programmatically, use the new `CLI.getLastTestRunHash(config)`.

```ts
// before
const hash = await CLI.run(config);

// after
CLI.run(config); // fire-and-exit
const hash = await CLI.getLastTestRunHash(config); // separate call
```

### CLI configuration

Pass configuration directly to `CLI.run`, `CLI.effect`, or the command helper.
The `Config` export is a TypeScript type. The unused `AppConfig` service has
been removed; a separate configuration layer is no longer needed.

### `diff --exit-on-diff`

- Previously died with `Effect.die('Non-empty diff.')`. Now fails with a typed `DiffNonEmpty` error.
- `CLI.run` translates it to `process.exitCode = 1` (user-visible behavior unchanged).
- Programmatic consumers of `_diff` must handle the new tag:

```ts
import {DiffNonEmpty} from '@creative-introvert/tons-of-tests-cli';

pipe(_diff(...), Effect.catchTag('DiffNonEmpty', () => /* handle */));
```

### New: `CLI.buildLayer(config)`

Builds the merged `NodeServices + TestRepository` layer for a config. Use it to
share one layer across multiple in-process operations.

### New CLI flags

- `summarize --tags foo,bar` — include results matching ANY tag.
- `summarize --all-tags foo,bar` — include results matching ALL tags.

### Behavior change: `diff` stats

`diff`'s reported stats now reflect the *visible* (filtered) entries, not the full run. Previously the filter was applied after the fold, so stats were full-run while the row list was filtered.

### Behavior change: `Classify.makeClassify`

When both `output` and `expected` are non-nil and unequal, the label is now `FP` (was `FP` via a different code path; semantics unchanged). When `output` is nil and `expected` is non-nil, the label is `FN` (was `FN`; unchanged). The default README example now declares a tolerant `classify`, so previously-`FP` near-matches in your suites may relabel to `TP` if you opt into a custom `isEqual`. Default strict equality is unchanged.
