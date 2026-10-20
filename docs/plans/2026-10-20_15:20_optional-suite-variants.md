Before revising, follow skill: ts-plan and get user approval. Delete this plan after implementation.

# Plan: Optional suite variants and saved-run comparisons

## Goal

- Let a suite share cases, schemas, and evaluation rules across named program variants.
- Keep the existing single `program` definition supported. A suite can define either `program` or `variants`.
- Give every execution a saved run ID. Track a separate baseline for each variant.
- Compare two saved runs with `diff`. Show several runs or all variant baselines with `stats`.
- Let users decide what their variants mean. The library checks that it can read the data and that selections are valid. It does not enforce semantic consistency or record program configuration automatically.

## Implementation context

- Work from `/home/ts/dev/creative-introvert/tons-of-tests`. Run every verification command below from this directory.
- Implement this plan in one session. Task 1 changes suite definitions, run storage, and existing CLI commands together. The remaining tasks add saved-run operations, commands, and examples.
- Read the current working tree before editing and preserve concurrent changes.
- Keep the required `TestSuiteSchemas<I, T, A, B>` contract: `testCase.input` describes `I`, `testCase.expected` describes the whole expectation `T`, and `evaluation.result` and `evaluation.expected` describe evaluated values `A` and `B`.
- Keep `TestResultSchemas<I, A, B>` required for repository reads, writes, and result rendering. It contains `testCase.input` and both evaluation codecs. It does not need the whole-case expectation.
- Reuse `internal/Test.serialization.ts`. Keep codecs that require no services, JSON encoding through `Schema.toCodecJson`, rejection of undeclared fields, round-trip equivalence checks, and canonical object-key order.
- Preserve `TestValueError` and its field, operation, suite, case number, key, and original cause.
- Keep the current report behavior: read results in bounded batches, write formatted rows to temporary files, calculate exact timing statistics through temporary SQLite tables, and send output through `Stdio`.
- Target a fresh database for this breaking change. Update the initial schema without adding readers or migrations for older database formats.

## Out Of Scope

- Comparing across database files, shared execution rounds, automatic model or prompt versioning, and automatic pruning of run history.
- Changesets, release work, dependency changes, and project configuration changes.
- README and migration-guide changes. Put lasting explanations in public API comments and the example.

## Task 1: Implement optional variants, independent runs, and variant baselines

Files:

- `workspace/tons-of-tests/src/TestRun.ts`
- `workspace/tons-of-tests/src/Test.ts`
- `workspace/tons-of-tests/src/Test.repository.ts`
- `workspace/tons-of-tests/src/RepositoryError.ts`
- `workspace/tons-of-tests/src/internal/Test.ts`
- `workspace/tons-of-tests/src/internal/Test.repository.sqlite.ts`
- `workspace/tons-of-tests/src/internal/test-repository-migrations.ts`
- `workspace/tons-of-tests/src/internal/test-repository-fixtures.ts`
- `workspace/tons-of-tests/src/internal/Test.repository.sqlite.spec.ts`
- `workspace/tons-of-tests/src/internal/Test.spec.ts`
- `workspace/tons-of-tests/src/internal/Test.serialization.spec.ts`
- `workspace/tons-of-tests-cli/src/Config.ts`
- `workspace/tons-of-tests-cli/src/common.ts`
- `workspace/tons-of-tests-cli/src/test-run.ts`
- `workspace/tons-of-tests-cli/src/summarize.ts`
- `workspace/tons-of-tests-cli/src/diff.ts`
- `workspace/tons-of-tests-cli/src/commit.ts`
- `workspace/tons-of-tests-cli/src/index.ts`
- `workspace/tons-of-tests-cli/src/diff.spec.ts`
- `workspace/tons-of-tests-cli/src/index.spec.ts`
- `workspace/tons-of-tests-cli/src/summarize.spec.ts`
- `workspace/tons-of-tests-cli/src/test-report.spec.ts`
- `workspace/tons-of-tests-cli/src/test-run.spec.ts`

Changes to suite definitions:

- Replace each `program` field in the two existing `TestSuite` evaluation branches with this choice:

```ts
type TestSuitePrograms<I, O, E, R> =
    | {
          program: Program<I, O, E, R>;
          variants?: never;
      }
    | {
          program?: never;
          variants: Readonly<Record<string, {
              program: Program<I, O, E, R>;
          }>>;
      };
```

- Use `TestSuitePrograms<I, O, E, R>` in the custom-evaluator branch. Use `TestSuitePrograms<I, O & NoInfer<A>, E, R>` in the default-evaluator branch. Preserve the latter's `T & NoInfer<B>` constraints on cases and schemas.
- Preserve the concrete suite type through `Test.all`, `AppConfigShape`, and CLI entry points and handlers.
- Derive errors and services from each program effect and the case stream using `Effect.Error`, `Effect.Services`, `Stream.Error`, and `Stream.Services`. Do not infer one shared `E` and `R` from all programs or widen returned channels to `any` or `unknown`.
- `Test.all` exposes the union of all configured programs’ errors and services, plus the case stream’s channels and existing library errors. This also applies when the selected variant is a literal. Execution still invokes only the selected program. An empty variants map contributes `never`.
- Keep cases, expected values, required schemas, and `evaluate` on the suite. A variant contains only its program. Model settings and configuration policy remain outside the library.
- Keep original values in `program`, `evaluate`, and `Test.all` results. For program outputs, require storage codecs only for evaluated values. A custom evaluator's whole output `O` need not be serializable.
- Without a custom evaluator, keep the requirement that `evaluation.result` and `evaluation.expected` use the same schema instance. Keep classification based on schema equivalence.
- Add a public `Test.selectVariant(suite, variant?)` operation. It returns an Effect whose successful value is the selected `{name, program}` and whose typed error channel is `TestVariantRequired | TestVariantNotFound`.
- `Test.selectVariant` requires no program services. Its returned program retains the union of the programs’ errors and services.
- Reuse `Test.selectVariant` in `Test.all(suite, {variant?, concurrency?})` and the CLI before execution or writes. Preserve `TestValueError` alongside program and selection failures in `Test.all`'s error channel.
- For a single-program suite, select the permanent implicit variant `default` when the option is absent.
- For a suite with named variants, require an explicit selection for execution, even when only one variant is configured.
- Check definitions before consuming cases. Require exactly one of `program` and `variants`.
- Require variant IDs to be nonempty, contain no comma, and not start with `run:`. Preserve IDs exactly. These restrictions keep CLI references unambiguous.
- Allow an empty variants map so users can inspect a suite after retiring all its programs. It has no executable variant.
- Use `TestVariantRequired` and `TestVariantNotFound` for selection failures. Treat invalid definition shapes as programmer errors. Keep these errors with the suite API.
- Keep variant identity out of case hashes and result matching keys. Keep hashing encoded original input and whole expected values through the current serialization code.
- Editing a program under the same key continues that variant's history. Renaming the key selects a different history.

Changes to saved runs:

- Replace the current-run slot with one row per execution, identified by suite and variant.
- Replace `TestRun.hash` with `variant` and `state`. Keep `id` and `name`, where `name` identifies the suite.
- Update `TestRunResults` and its consumers to carry the revised run metadata.
- Use these stored fields and keys:

```text
test-runs:
  id INTEGER PRIMARY KEY AUTOINCREMENT
  name TEXT NOT NULL
  variant TEXT NOT NULL
  state TEXT NOT NULL CHECK (state IN ('Running', 'Complete', 'Failed'))
  INDEX (name, variant, id)

test-baselines:
  name TEXT NOT NULL
  variant TEXT NOT NULL
  testRun INTEGER NOT NULL REFERENCES test-runs(id)
  PRIMARY KEY (name, variant)
```

- Keep result content separate from each run's ordering, tags, and timing. Pass the required shared schemas to every result read and write.
- Change `withTestRun` to accept `{name, variant}` and an execution callback. It creates a `Running` row and passes that run to the callback. On success, it returns the completed run together with the callback value.
- Use `Effect.acquireUseRelease` to create the run, invoke the interruptible callback, and save its final state.
- The finalizer writes `Complete` after callback success and `Failed` after a typed failure, defect, synchronous callback throw, or interruption. Preserve saved rows. Serialization failures during execution or saving also fail the attempt.
- Return success and completed-run metadata only after `Complete` has been saved.
- Propagate finalization failures. When execution also fails, preserve both causes. Do not swallow database errors or rerun the callback.
- A failed final-state write or abrupt process exit can leave a run `Running`. Such runs remain ineligible for commit and cache reuse. Recovery is outside this plan.
- Use short transactions for creation, batch writes, and completion. Do not hold a transaction while the program runs.
- Allow result writes only while the target row is `Running`. Check this inside each write transaction. Completed and failed runs cannot be cleared, overwritten, or executed again.
- Replace the old current/hash methods with `getTestRun(id)`, `getLatestTestRun({name, variant})`, `getBaselineTestRun({name, variant})`, `commitTestRun(id)`, `listTestRuns({name, variant?, before?, limit})`, and `listVariantBaselines(name)`.
- Make lookup methods return `Option`. Reads never create rows.
- Make `getLatestTestRun` select the greatest ID for that suite and variant, regardless of state.
- Make `listTestRuns` order by descending ID, accept limits from 1 through 100, and use `id < before` for the next page.
- Make `listVariantBaselines` include every variant found in saved runs and its optional baseline.
- Make `commitTestRun` read the target row and require `Complete`. A successful empty run qualifies.
- In one transaction, derive the suite and variant from the target row and upsert only its baseline pointer. Repeating the commit is harmless. An older complete run may become the baseline again.
- Add `TestRunNotFound` and `TestBaselineNotFound` failures. Extend `TestRunIncomplete` with the run ID and variant. Preserve SQL, schema, and `TestValueError` failures.
- Remove automatic cleanup from commit. Remove the current-slot/hash APIs that no longer have meaning.

Changes to existing CLI commands:

- Add `--variant` to `summarize`, implicit `diff`, and `commit`. Keep it optional for single-program definitions.
- Resolve cache and baseline state using both the suite name and selected variant ID.
- Replace `CLI.getLastTestRunHash` with `CLI.getBaselineRun(config, variant?)`, returning the selected baseline or null.
- Each fresh `summarize` or implicit `diff` creates an attempt for the selected variant.
- Make `--cached` reuse the latest attempt when it is `Complete`, even when that run is also the baseline.
- If the latest attempt is `Running` or `Failed`, make `--cached` start a new independent attempt. Never wait for or overwrite the existing attempt. Never fall back to an older complete run.
- Finish consuming and saving the full result stream before preparing a fresh run's report from stored rows. Keep both passes streamed. Read stored values through the same shared codecs.
- Mark the saved run `Complete` after execution succeeds. A later report-decoding, formatting, or output failure leaves that state unchanged.
- Make `commit --variant` select the latest attempt and promote that exact ID. Reject a failed or running latest attempt. Changing a baseline never removes earlier runs.
- Keep the existing command names, result filters, concurrency, and `DiffNonEmpty` exit behavior for the selected program. Run the entire selected variant before filtering its report.

Tests:

- Type-check and execute both definition forms through `Test.all`. Cover custom and default evaluation, incompatible program outputs, both forms supplied together, and neither supplied. Preserve the default branch's `NoInfer` checks and same-schema-instance rule.
- Compile inline suites through `Test.all` and `CLI.effect` with different program errors and services and a case stream with its own error and service. Assert exact unions without explicit `E`/`R` annotations.
- Cover both evaluation branches, single-program suites, and an empty variants map. These checks catch rejected valid suites and lost type information.
- Run identical cases under A and B. Assert that each selected program runs once per distinct case, case/key identities match, and selecting one variant does not execute another.
- Through the real SQLite repository, save several runs for A, B, and C. Commit and recommit selected IDs. Assert that each variant has its own baseline, earlier results remain readable, and both survive reopening the database. This catches history loss and commits that affect another variant.
- Overlap two repository attempts for one variant and finish them in reverse order. Assert distinct IDs and results, then commit an exact ID and verify its baseline pointer. This catches attempts overwriting each other or commits selecting by completion order.
- Exercise success, empty success, failure after saved batches, and interruption through `withTestRun`. Assert the final state and whether each run can be committed. This catches partial results becoming baselines.
- Add synchronous callback throws and Effect defects to the success, typed-failure, and interruption cases. Verify saved rows and states.
- Verify that failed run creation never invokes the callback.
- Force final-state writes to fail in the SQLite repository tests. Verify that success is not reported, the run cannot be committed, and both causes survive when execution also fails.
- Attempt writes to completed and failed runs. Assert refusal and unchanged saved values, including tags and timings. This catches edits to historical results.
- Adapt the existing serialization tests to the new run API. Keep checks for original values, bigint and Date round trips, whole-case hashing, custom evaluators with nonserializable whole outputs, lossy encodings, and undeclared fields. Exercise named variants through this path and preserve `TestValueError` details.
- Through public CLI calls, verify separate A/B execution, cache reuse, and commits. Fresh execution gets a new ID; cache reuse makes no program calls. A `Running` or `Failed` latest attempt triggers a new execution. Report failure leaves successfully saved results complete.
- Verify missing or unknown selections fail before execution or run creation. A single-program suite still runs and commits without `--variant`. An empty variants map cannot execute a program.

Verify:

- Run `direnv exec . pnpm exec vitest run workspace/tons-of-tests/src/internal/Test.repository.sqlite.spec.ts workspace/tons-of-tests/src/internal/Test.spec.ts workspace/tons-of-tests/src/internal/Test.serialization.spec.ts workspace/tons-of-tests-cli/src`.
- Run `direnv exec . just typecheck`.
- Expected: both suite forms compile and execute. Histories, baselines, and cache reuse remain separate for each variant. The existing serialization guarantees remain covered.

## Task 2: Expose saved-run comparison and summary operations in the core

Files:

- `workspace/tons-of-tests/src/Test.ts`
- `workspace/tons-of-tests/src/internal/Test.ts`
- `workspace/tons-of-tests/src/internal/Test.spec.ts`
- `workspace/tons-of-tests/src/Test.repository.ts`
- `workspace/tons-of-tests/src/internal/Test.repository.sqlite.ts`
- `workspace/tons-of-tests/src/Show.ts`
- `workspace/tons-of-tests/src/internal/summarize.ts`
- `workspace/tons-of-tests/src/internal/stats.ts`
- `workspace/tons-of-tests-cli/src/test-run.ts`
- `workspace/tons-of-tests-cli/src/test-report.spec.ts`

Depends on: Task 1.

Changes:

- Expose `Test.compareRuns({from, to, schemas})` as a stream of matched results and results present on only one side.
- Make `from` and `to` resolved `TestRun` values. They are not numeric IDs or CLI reference strings.
- Require complete saved runs. Check their saved state through the repository before reading result streams.
- Require `schemas: TestResultSchemas<I, A, B>` and decode both runs with those shared codecs.

```ts
type TestResultComparison<I, A, B> =
    | {
          _tag: 'Matched';
          from: TestResult<I, A, B>;
          to: TestResult<I, A, B>;
          changed: boolean;
      }
    | {_tag: 'OnlyFrom'; from: TestResult<I, A, B>}
    | {_tag: 'OnlyTo'; to: TestResult<I, A, B>};
```

- Match by `(hashTestCase, key)`.
- Mark a matched result changed when its label, evaluated result, or evaluated expected value changes. Use `Schema.toEquivalence` on decoded values.
- Keep saved labels; do not call `evaluate` again. Timing, ordering, and tag changes alone do not count as differences.
- Emit rows in the `to` run's saved order, followed by `OnlyFrom` rows in the `from` run's saved order. Include results missing from either side.
- Process 50 results at a time using the existing matching lookup. Make a second bounded pass to find `OnlyFrom` rows. Do not collect either complete run or all matching keys in memory.
- Expose `Test.summarizeRun({run, schemas, predicate?})`, returning that run and its `Stats`.
- Make `run` a resolved `TestRun` value, not a numeric ID or CLI reference string. Require `schemas: TestResultSchemas<I, A, B>`. Check the saved run state before reading the result stream.
- Consume results in batches with the existing exact SQLite stats collector. The optional predicate is a pure result filter over decoded values supplied by the caller.
- Require complete runs for summaries. Empty complete runs return zero counts and absent timing values.
- Preserve `TestValueError` when a selected run cannot be decoded with the supplied schemas. Do not fall back to untyped JSON or execute its program.
- Keep SQL lookups in `TestRepository`, comparison and statistics in the core, rendering in `Show`, and command selection in the CLI.
- Extend `Show` with a comparison report that can display either missing side. Add a compact table for several run summaries.
- Label each side with its suite, variant, and actual run ID. Use the shared result codec to display encoded JSON. Use each side's own suite name for serialization-error context.
- Keep result rendering effectful and preserve conversion failures in the error channel. Reuse the temporary-file report path and scoped cleanup. Do not accumulate the whole report in JavaScript.
- Apply existing diff view filters after matching. Use the `to` result when present and the `from` result for removed rows.
- Keep a matched counterpart visible even when its old label or tags do not satisfy the filter.
- Keep diff statistics limited to visible changed rows and label that scope in the report. Calculate numeric differences as `to` minus `from`.
- Make the new `stats` view in Task 3 report all selected results, including unchanged ones.
- Count each represented case once per side when calculating timing statistics.

Tests:

- Exercise `Test.compareRuns` with reordered cases and evaluation keys, changed labels and values, equal values under a custom schema, additions, removals, and the same run on both sides. Assert exact pairs and ordering. This catches incorrect matching and missing deletions.
- Exercise `Test.summarizeRun` with filtered results, multiple evaluations per case, and an empty completed run. Assert counts, mean, and median. This catches timing counted once per evaluation.
- Extend report integration tests beyond one page of results, using bigint, Date, and custom codecs whose encoded and decoded values differ. Check decoded comparison and filter values, encoded display values, and scoped cleanup after failure. Test data selection and encoding rather than table-border snapshots.
- Read a saved run with incompatible codecs through both comparison and summary operations. Assert `TestValueError` with the saved run's suite and field, no program calls, and unchanged runs and baselines. This catches silent schema fallbacks and errors attributed to the wrong suite.

Verify:

- Run `direnv exec . pnpm exec vitest run workspace/tons-of-tests/src/internal/Test.spec.ts workspace/tons-of-tests-cli/src/test-report.spec.ts`.
- Run `direnv exec . just typecheck`.
- Expected: comparisons include missing cases on both sides, preserve typed values and conversion errors, and keep exact filtered statistics across batch boundaries.

## Task 3: Add saved-run selectors, baseline overviews, and run discovery

Files:

- `workspace/tons-of-tests-cli/src/common.ts`
- `workspace/tons-of-tests-cli/src/test-run.ts`
- `workspace/tons-of-tests-cli/src/diff.ts`
- `workspace/tons-of-tests-cli/src/commit.ts`
- `workspace/tons-of-tests-cli/src/index.ts`
- New `workspace/tons-of-tests-cli/src/stats.ts`
- New `workspace/tons-of-tests-cli/src/runs.ts`
- `workspace/tons-of-tests-cli/src/diff.spec.ts`
- `workspace/tons-of-tests-cli/src/index.spec.ts`
- `workspace/tons-of-tests-cli/src/test-run.spec.ts`
- New `workspace/tons-of-tests-cli/src/stats.spec.ts`
- New `workspace/tons-of-tests-cli/src/runs.spec.ts`

Depends on: Task 2.

Changes:

- Parse a bare variant ID as its baseline in the configured suite.
- Parse `run:<positive integer>` as an exact saved run in the configured database. Reject malformed references before accessing stored results.
- Resolve each reference once at command start. Require explicit references to exist and be complete. Never run a program as a fallback.
- Allow exact run references to read runs from other suites in the same database. Use the configured suite's shared codecs. The caller owns their semantic compatibility.
- Include suite names when identifying runs in reports.
- Add these commands and modes. Arguments below follow the user's existing TypeScript entry point:

```text
summarize --variant A
summarize --variant A --cached
commit --variant A
commit --run run:17
diff --variant A
diff --from A --to B
diff --from run:17 --to run:23
stats
stats --runs A,B
stats --runs run:17,run:23,run:29
runs
runs --variant A --limit 50 --before 100
```

- Require both `--from` and `--to` for explicit `diff`. Reject either flag combined with `--variant` or `--cached`.
- Keep implicit `diff` as execution or cache reuse of the selected variant against its baseline. If that baseline is missing, show all current results as new.
- Make explicit diff read saved data only.
- Make `--exit-on-diff` count visible changed, added, and removed result rows. Preserve the public `DiffNonEmpty` failure and exit-code behavior.
- Make `commit --run` promote that exact complete run, including runs of retired variants. Require it to belong to the configured suite. Reject combining `--run` with `--variant`.
- Make `stats` include both configured variant IDs and stored variant IDs for the configured suite.
- Show configured variants in definition order, then stored-only variants in name order. Mark stored-only variants retired.
- Show each baseline's actual run ID, case count, result count, precision, recall, and mean time.
- Show a variant without a baseline as a row with absent metrics. Distinguish this from a completed empty baseline with zero counts.
- Require an explicit `stats --runs` list to be nonempty. Preserve its requested order and fail on missing selections.
- Apply existing result filters independently to each run. Show each run's resulting counts without silently restricting the runs to their shared results.
- Summarize selected runs sequentially. Release each stats collector before starting the next. Keep summary rows in memory, not test results.
- Make `runs` list saved attempts for the configured suite, optionally filtered by variant. Show the run ID, variant, state, and whether it is the baseline.
- Default `runs` to 50 rows. Enforce the repository's 1–100 limit and descending-ID pagination.
- Print the created or reused run ID during execution commands so users can select it later.

Tests:

- Through `CLI.effectNoDeps` and a shared real repository, compare different variants and exact older runs. Assert the reported IDs and rows, no program calls, and unchanged runs and baselines after read commands.
- Build histories A1/A2/A3, B2/B3, and C1/C2. Remove C from the definition and add a variant without a baseline. Assert default overview order, retired C's baseline, and the missing-baseline row.
- Exercise explicit overview ordering, result filters, cross-suite read references with compatible schemas, and unknown or incomplete selections. This catches fallback execution and misleading zero metrics.
- Exercise missing diff endpoints, conflicting flags, invalid IDs, an empty explicit `stats --runs` list, and `--exit-on-diff` on a removal. Assert typed failure or CLI parse failure before any program execution.
- Exercise explicit commit of an older complete run, a retired variant, and a run from another suite. Assert that only the intended baseline changes and that the cross-suite write is rejected.
- List more than one page through `runs`. Assert descending IDs, no repeated or skipped IDs, baseline markers, and invalid-limit rejection.

Verify:

- Run `direnv exec . pnpm exec vitest run workspace/tons-of-tests-cli/src`.
- Run `direnv exec . just typecheck`.
- Expected: saved comparison and overview commands perform no program execution or baseline changes. All selection, history, and pagination cases pass.

## Task 4: Add the example, document public contracts, and check the complete change

Files:

- New `workspace/examples/src/with-cli/variants.ts`
- Public API comments in the core and CLI files changed above.

Depends on: Task 3.

Changes:

- Add a deterministic local example with A, B, and C programs sharing cases, required schemas, and evaluation. Use valid current codecs and no external model calls.
- Explain both definition forms, stable variant IDs, and the implicit `default` identity in the `TestSuite` API comments.
- Explain how program and case-stream errors and services combine, and that callers provide any required services.
- Put example commands for execution, cache reuse, committing latest or exact runs, baseline comparisons, exact-run comparisons, overview statistics, and run discovery beside the example.
- Explain that `--cached` reuses the latest attempt when it is `Complete`, even when it is the baseline. A `Running` or `Failed` latest attempt causes a fresh run.
- Document on the public run and repository APIs that saved results persist after program edits or retirement. Completed runs are immutable, and committing changes only a baseline pointer. Explain that history grows without automatic pruning.
- Document the shared-codec requirement, user-owned semantic compatibility, missing baselines, and empty complete runs on the new comparison and summary APIs.
- Explain the difference between diff statistics for changed rows and statistics for all selected results in command help and the example.
- Describe `CLI.getBaselineRun` and the new repository operations at their public definitions. State the fresh-database requirement at the repository layer and in the example.
- Document callback finalization, propagated database failures, and the conditions that can leave a run `Running`.
- Keep lasting API and behavior rules in these comments and the example so they survive deletion of this plan.

Verify:

- Run `direnv exec . just check-fix`. Review its changes and preserve concurrent edits.
- Run `direnv exec . just verify`.
- Run `direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts --help`.
- Expected: lint, formatting, types, unit tests, and package builds pass. The example help lists `summarize`, `diff`, `commit`, `stats`, and `runs` without executing a program.
