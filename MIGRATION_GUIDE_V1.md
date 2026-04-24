# Migration Guide — v1.0

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

- `TestRepository.TestRepository` is now an `Effect.Tag` class (was `Context.GenericTag`). Access via `yield* PT.TestRepository.TestRepository` still works; manual `.of(...)` construction does not.
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
  schemas?: { input: Schema<I>; result: Schema<O>; expected: Schema<T> };
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

### `Config` → `AppConfig`

- `Config` (the `Context.GenericTag`) → `AppConfig` (`Context.Tag` class).
- `makeConfigLayer(config)` → `AppConfig.layer(config)`.
- The config *shape* type is `AppConfigShape<I, O, T>` (re-exported as `Config` for convenience).

```ts
// before
import {Config, makeConfigLayer} from '@creative-introvert/tons-of-tests-cli';
const layer = makeConfigLayer(config);
const cfg = yield* Config;

// after
import {AppConfig} from '@creative-introvert/tons-of-tests-cli';
const layer = AppConfig.layer(config);
const cfg = yield* AppConfig;
```

### `diff --exit-on-diff`

- Previously died with `Effect.die('Non-empty diff.')`. Now fails with a typed `DiffNonEmpty` error.
- `CLI.run` translates it to `process.exitCode = 1` (user-visible behavior unchanged).
- Programmatic consumers of `_diff` must handle the new tag:

```ts
import {DiffNonEmpty} from '@creative-introvert/tons-of-tests-cli';

pipe(_diff(...), Effect.catchTag('DiffNonEmpty', () => /* handle */));
```

### New: `CLI.buildLayer(config)`

Builds the merged `NodeContext + AppConfig + TestRepository` layer for a config. Use to share one layer across multiple in-process operations.

### New CLI flags

- `summarize --tags foo,bar` — include results matching ANY tag.
- `summarize --all-tags foo,bar` — include results matching ALL tags.

### Behavior change: `diff` stats

`diff`'s reported stats now reflect the *visible* (filtered) entries, not the full run. Previously the filter was applied after the fold, so stats were full-run while the row list was filtered.

### Behavior change: `Classify.makeClassify`

When both `output` and `expected` are non-nil and unequal, the label is now `FP` (was `FP` via a different code path; semantics unchanged). When `output` is nil and `expected` is non-nil, the label is `FN` (was `FN`; unchanged). The default README example now declares a tolerant `classify`, so previously-`FP` near-matches in your suites may relabel to `TP` if you opt into a custom `isEqual`. Default strict equality is unchanged.
