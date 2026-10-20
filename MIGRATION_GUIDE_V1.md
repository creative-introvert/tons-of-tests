# Migration Guide — v1.0

## Effect 4 update

The next major release uses Effect 4 and requires Node.js 24 or newer.
Update your `effect` dependency and any `@effect/*` packages together.
The examples below use the current API names.

- `@effect/platform`, `@effect/sql`, and `@effect/cli` are now part of `effect`.
- Services use `Context.Service`. Platform services use `NodeServices.layer`.
- Cached-value schemas use `Schema.Codec<T>`. Their encoded and decoded types
  must match the values saved by the test runner.
- Repository failures keep their original `SqlError` or `Schema.SchemaError`
  types. The repository error wrappers have been removed.
- `TestRunNotCreated.testSuiteName` replaces its old `name` payload field.
  `name` now identifies the error type.
- Statistics and timings require finite numbers.
- Explicit CLI arguments still include the Node and script names, for example
  `['node', 'suite.ts', 'summarize']`.

The SQLite driver now uses `node:sqlite`. It no longer needs `better-sqlite3`
or its native build tools. Test-case hashes and result IDs are unchanged.

## Database setup

This release requires a fresh SQLite database. Set `dbPath` to a new file, run
the suite, and commit its results to create a new baseline. Old database formats
are not upgraded. You can keep the old file for use with the old package version.

The initial migration creates the current tables and indexes directly.
Effect's `SqliteMigrator` records completion in `tons_of_tests_migrations`, so
reopening a database created by this release preserves its results.

Tags use JSON and belong to each run. A later run can change its tags without
changing a committed run. Tags preserve commas, empty strings, and whitespace.
A successful CLI execution becomes `Complete`, even when the suite is empty.
Failed or interrupted executions cannot be reused by `--cached` or committed.

## `@creative-introvert/tons-of-tests`

### Removed

- `Error` module — `DuplicateTestCase` is gone. The `Error` namespace now re-exports `RepositoryError`.
- `TestRepository.LiveLayer` — replaced by `TestRepository.TestRepository.layerNoDeps`.
- `TestRepository.TestRepository.Live` — use `layerNoDeps`; there is no alias.
- `TestRepository.makeSqliteLiveLayer(dbPath)` — replaced by `TestRepository.TestRepository.layer(dbPath)`.
- `TestRepository.SqliteTestLayer` — replaced by `TestRepository.TestRepository.TestLayer`.
- `pack` — a build tool, no longer exported from the main package.
- `TestRepository.TestResultRead` and `TestRepository.TestRunResults` — private
  database row shapes. Use `Test.TestResult` and `Test.TestRunResults` for results.
- `getAllTestResults`, `getAllTestRuns`, and `getAllTestRunResults` — test helpers,
  no longer repository methods. Read a run through `getTestResultsStream`.
- `RepositoryQueryError`, `RepositoryWriteError`, and `RepositoryDecodeError` —
  handle `SqlError` or `SchemaError` directly.

### Renamed / moved

- `TestRepository.TestRepository` is a `Context.Service` class (was `Context.GenericTag`). Access it with `yield* PT.TestRepository.TestRepository`.
- `TestRun` is a branded `Schema.Class`. Construct it with
  `new TestRun({id, name, hash})` or decode it with its schema. Plain objects
  no longer satisfy the `TestRun` type. Collected `TestRunResults` remain
  plain objects with the run's `id`, `name`, and `hash`.
- `Classify.Stats` is now a `Schema.Class`. Construct with `new Stats({...})` or `Stats.empty()`. The standalone `StatsSchema` export is removed (use `Stats` itself).

### Repository API changes

- `insertTestResult(input, name: string)` → `insertTestResult(input, testRun: TestRun)`. The second arg is a resolved `TestRun`, not a suite name.
- New: `insertTestResults(inputs: ReadonlyArray<TestResult>, testRun: TestRun)` for batch inserts.
- `getTestResultsStream(testRun)` now accepts an optional `schemas?: TestResultSchemas<I, O, T>` second arg and returns `Stream<TestResult<I, O, T>, RepositoryError>`.
- `RepositoryError` is the union of `SqlError | Schema.SchemaError |
  TestRunNotCreated | TestRunIncomplete`. SQL and schema failures pass through;
  the two domain errors describe outcomes that callers can handle.
- `commitCurrentTestRun` returns `'Committed'` or `'NothingToCommit'`.
  The repository no longer prints commit messages. The CLI prints the same
  messages as before.
- `withTestRun(testRun, execute)` clears the current results and tracks the
  execution. It marks the run complete only when `execute` succeeds. Use it
  around direct runner calls that save results, so failed and interrupted
  executions cannot become a baseline.
- `isComplete(testRun)` checks completion. `hasResults(testRun)` only checks
  whether any rows are saved; it does not prove the whole suite ran.
- Direct `insertTestResults` calls remain untracked. Callers can still commit
  those rows, but `--cached` will only reuse a completed run.
- `layerNoDeps` requires a supplied `SqliteClient`. `layer(dbPath)` includes
  that client.
- `TestLayer` remains available for tests that need an in-memory SQLite database.

### `TestSuite`

New optional field:

```ts
testSuite: {
  // ...
  schemas?: { input: Schema.Codec<I>; result: Schema.Codec<O>; expected: Schema.Codec<T> };
}
```

Required if you want typed (non-`unknown`) decoding from cached rows.

The runner now warns and skips repeated cases before calling `program`. It
keeps the first case with each input/expected-value hash, including its tags.
Different tags do not make a duplicate case distinct. This works for arrays
and streams, and the suite continues after each warning.

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

### Report output

Tables are written through Effect's `Stdio.stdout()` sink, which waits when
the output pipe is busy. Supply a `Stdio` service through `CLI.effectNoDeps`
to redirect table output. Overriding `Console` no longer redirects tables.
The old collecting command helpers (`_sumarize` and `_diff`) have been removed;
both commands use the batch report workflow.

### `diff --exit-on-diff`

- Previously died with `Effect.die('Non-empty diff.')`. Now fails with a typed `DiffNonEmpty` error.
- `CLI.run` translates it to `process.exitCode = 1` (user-visible behavior unchanged).
- Programmatic consumers of `CLI.effect` and `CLI.effectNoDeps` can handle the new tag:

```ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

CLI.effect(config, ['node', 'suite.ts', 'diff', '--exit-on-diff']).pipe(
    Effect.catchTag('DiffNonEmpty', error => Effect.succeed(error.count)),
);
```

### New: `CLI.buildLayer(config)`

Builds the merged `NodeServices + TestRepository` layer for a config. Use it to
provide services once around several `CLI.effectNoDeps(config, args)` calls.
`CLI.effect` still supplies its own services for each call. See the
[shared repository example](./README.md#using-the-cli-programmatically).

### New CLI flags

- `summarize --tags foo,bar` — include results matching ANY tag.
- `summarize --all-tags foo,bar` — include results matching ALL tags.

### Large reports

`summarize` and `diff` now read and compare results in batches. They keep formatted
rows in a temporary file and timing values in temporary SQLite tables. The
tables, filters, exact median, and command arguments stay the same. Fresh output
still uses the values from the runner; it is not read back through cached-value
schemas.

Temporary storage grows with the report size. The runner still keeps one hash
per distinct case for duplicate detection. Supplied case arrays remain in
memory; streams let callers load cases as needed. Resources are cleaned up
after success, failure, or interruption.

`Test.runCollectRecord`, `Test.filterResults`, and `Show.summarize` are available
for callers that choose to collect results or table text in memory.
`Show.prepareSummary` is available for callers that want to print table chunks;
keep its returned stream inside the `Effect.scoped` call that prepares it.

### Behavior change: `diff` stats

`diff`'s reported stats now reflect the *visible* (filtered) entries, not the full run. Previously the filter was applied after the fold, so stats were full-run while the row list was filtered.

### Behavior change: `Classify.makeClassify`

When both `output` and `expected` are non-nil and unequal, the label is now `FP` (was `FP` via a different code path; semantics unchanged). When `output` is nil and `expected` is non-nil, the label is `FN` (was `FN`; unchanged). The default README example now declares a tolerant `classify`, so previously-`FP` near-matches in your suites may relabel to `TP` if you opt into a custom `isEqual`. Default strict equality is unchanged.
