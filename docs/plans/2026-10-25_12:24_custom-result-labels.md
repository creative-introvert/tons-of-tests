Before revising, follow skill: ts-plan and get user approval. Delete this plan after implementation.

# Plan: Custom result labels and report colors

## Goal

- Extend TP/TN/FP/FN with custom labels such as `failure-timeout`.
- Include custom labels in result tables, counts, comparisons, filters, cached reports, and saved reports.
- Let users choose each label’s color and valence. Valence says whether a higher count is better, worse, or neutral.
- Keep program errors in the Effect error channel. Users decide which errors to turn into output values and how to classify those values.

## Scope

- Complete this change in one implementation session using the installed Effect v4 APIs.
- Keep result values in `result`. Store each classification’s name as a string in `label`.
- Read colors and valence from current display settings. Saved runs retain their labels and use the settings supplied when they are reported.
- Keep README, MIGRATION_GUIDE, release files, dependencies, and project tooling configuration unchanged.

## Task 1: Define labels and counts

Files:

- `workspace/tons-of-tests/src/Classify.ts`
- `workspace/tons-of-tests/src/internal/Classify.ts`
- `workspace/tons-of-tests/src/Test.ts`
- `workspace/tons-of-tests/src/TestValueError.ts`
- `workspace/tons-of-tests/src/internal/Test.serialization.ts`
- `workspace/tons-of-tests/src/internal/Test.serialization.spec.ts`

Changes:

- Keep the four built-in confusion labels explicit. Their names retain their meaning in precision and recall calculations.
- Expand `Classify.LabelSchema` to accept custom names. Require non-empty names with no leading or trailing whitespace, commas, or ASCII control characters.
- Preserve each name’s case and spelling. Commas remain the CLI filter separator.
- Keep `makeClassify` producing only TP/TN/FP/FN. An explicit `evaluate` callback can return any valid label.
- Parse labels in `makeResultCodec.encode`, which both execution and repository writes use.
- Add `evaluation.label` to `TestValueError.field`. Report invalid labels with the suite, case number, evaluation key, and encode operation.
- Replace the four top-level count fields in `Stats` and `Test.Diff` with one `counts` record.
- Keep counts separate from metrics so a custom label named `total` or `precision` cannot overwrite a metric.
- Keep the existing total, case count, precision, recall, and timing fields in `Stats`.
- Initialize the four built-in counts to zero in `Stats.empty()`.
- Document label rules, count access, metric scope, and the user’s role in handling errors on the public interfaces.

Use these contracts:

```ts
export const ConfusionLabelSchema = Schema.Literals(['TP', 'TN', 'FP', 'FN']);
export type ConfusionLabel = typeof ConfusionLabelSchema.Type;

export const LabelSchema = Schema.String.check(
    Schema.isMinLength(1),
    Schema.isTrimmed(),
    Schema.isPattern(/^[^,\u0000-\u001F\u007F]+$/u),
);
export type Label = typeof LabelSchema.Type;

// Field in the existing Stats schema:
counts: Schema.Record(LabelSchema, Schema.Int)

// Test.ts
export type Diff = {
    counts: Readonly<Record<Label, number>>;
    precision: number;
    recall: number;
};
```

Tests:

- Through `Test.all` and the serialization boundary, accept a custom label unchanged. Reject names that are empty, padded with whitespace, or contain commas or ASCII control characters with `TestValueError`. This prevents invalid names from reaching storage or report filters.
- Update existing consumers and assertions to read counts through `stats.counts`. The final checks in Task 5 catch missed references.

## Task 2: Count, save, and compare every label

Files:

- `workspace/tons-of-tests/src/internal/Test.ts`
- `workspace/tons-of-tests/src/internal/test-result-stats.ts`
- `workspace/tons-of-tests/src/Test.repository.ts`
- `workspace/tons-of-tests/src/internal/Test.repository.sqlite.ts`
- `workspace/tons-of-tests/src/internal/Test.spec.ts`
- `workspace/tons-of-tests/src/internal/Test.repository.sqlite.spec.ts`

Depends on: Task 1.

Changes:

- Update both `runCollectRecord` and `withStats` to count each result by its exact label.
- Remove the fallback that treats every unknown label as FN.
- Use maps while accumulating counts and own-property lookups on count records. Support labels such as `constructor` and `__proto__`.
- Derive `total` from all label counts.
- Count each selected case’s duration once, including cases with custom results.
- Calculate precision as TP/(TP+FP) and recall as TP/(TP+FN). Custom counts do not enter either formula.
- Preserve the existing result of zero when a denominator is zero.
- Compute count differences over the union of labels on both sides.
- Treat a label missing from an existing run as zero. Keep a missing run distinct from an empty run.
- Keep result matching by case hash and evaluation key. Keep label changes in content IDs and change detection.
- Broaden stored-row label decoding through the shared schema.
- Keep the SQL layout and format markers unchanged. Labels remain text, and current built-in rows remain valid.
- Keep color and valence out of stored results, hashes, and comparison equality.
- Keep raw snapshot copying, run failure states, and program error propagation unchanged.
- Preserve streaming and existing database batch sizes.
- Accumulate one counter per distinct label without rescanning results or querying once per label.

Count differences must follow this rule:

```ts
const labels = new Set([
    ...Object.keys(before.counts),
    ...Object.keys(after.counts),
]);

const count = (counts: Readonly<Record<string, number>>, label: string) =>
    Object.hasOwn(counts, label) ? counts[label] : 0;

const counts = Object.fromEntries(
    [...labels].map(label => [
        label,
        count(after.counts, label) - count(before.counts, label),
    ]),
);
```

Tests:

- Exercise `Test.runCollectRecord`, `Test.filterResults`, and repository `withStats` with mixed built-in and custom results across batches. Check counts, totals, metrics, and one timing contribution per case.
- Include labels named `total`, `precision`, `constructor`, and `__proto__`. This catches metric collisions and inherited-property bugs.
- Check empty runs and runs containing only custom results. Custom results must not become FN.
- Through `Test.compareRuns` and `Test.diff`, check unchanged custom labels, TP-to-custom changes, custom-to-custom changes, and categories appearing or disappearing.
- Save, commit, reopen, and read custom labels unchanged. Extend the raw-copy test to prove commit preserves them without calling user value codecs.
- Replace the repository test’s now-valid `NOT_A_LABEL` corruption fixture with an invalid name such as an empty string.
- Retain the test proving that an unhandled program error propagates without calling `evaluate`.
- Add a handled-error case proving that the user’s output reaches `evaluate` as a normal value.

## Task 3: Apply label settings throughout reporting

Files:

- `workspace/tons-of-tests/src/DisplayConfig.ts`
- `workspace/tons-of-tests/src/internal/DisplayConfig.ts`
- `workspace/tons-of-tests/src/Show.ts`
- `workspace/tons-of-tests/src/internal/stats.ts`
- `workspace/tons-of-tests/src/internal/diff.ts`
- `workspace/tons-of-tests/src/internal/summarize.ts`
- `workspace/tons-of-tests/src/internal/common.ts`
- `workspace/tons-of-tests/src/internal/stats.spec.ts` — add
- `workspace/tons-of-tests/src/internal/diff.spec.ts` — add

Depends on: Tasks 1 and 2.

Changes:

- Add label settings to `DisplayConfig`, with an empty map in `makeDefault`. The existing `Partial<DisplayConfig>` API lets callers omit it.
- Allow display overrides for any label. Overriding a built-in label changes presentation only.
- Default built-in valence to positive for TP/TN and negative for FP/FN.
- Keep built-in labels’ existing styling when no override is supplied.
- Default custom valence to neutral.
- When a custom label has no color setting, use green for positive, red for negative, and no color for neutral.
- Use an explicit color for labels and absolute counts in place of the default.
- Apply these settings to current and previous labels, absolute count cells, both sides of saved comparisons, and run summaries.
- Keep valence and color separate for count differences. Positive means increases are green and decreases red; negative reverses that rule.
- Show neutral differences in the category’s color without judging the change.
- Show zero differences without color.
- Honor `colorize: false` for the complete report, including titles and borders. Do not mutate global color settings.
- Generate classification columns from counts. Show TP, TN, FP, FN first, followed by custom labels sorted by exact string order.
- For comparisons, include labels seen on either side.
- For run overviews, use the union of labels across the displayed runs.
- Show zero for an absent category in an existing run and `-` for a missing run.
- Keep configured but unused custom labels out of default columns. Explicit column selection can request them as zero.
- Use `count:<label>` as the column selector for a classification count. Keep metric selectors such as `total` and `precision`.
- Display the actual label in the header. If it matches a metric header in the same table, append ` (count)`.
- Keep shared label display logic in `internal/DisplayConfig.ts`. Keep report construction in its existing modules.

Use these public settings:

```ts
export type LabelColor =
    | 'red' | 'green' | 'yellow' | 'blue'
    | 'magenta' | 'cyan' | 'white' | 'gray' | 'none';

export type LabelDisplay = {
    readonly color?: LabelColor;
    readonly valence?: 'positive' | 'negative' | 'neutral';
};

// Field in DisplayConfig:
labels: Readonly<Record<string, LabelDisplay>>;
```

Example:

```ts
displayConfig: {
    labels: {
        'failure-timeout': {color: 'magenta', valence: 'negative'},
        recovered: {color: 'cyan', valence: 'positive'},
        inconclusive: {color: 'yellow', valence: 'neutral'},
    },
}
```

Documentation:

- Explain that negative valence means fewer results in this category is better.
- Explain that current display settings also apply to cached and committed runs.

Tests:

- Through `Show.stats` and `Show.runSummaries`, check dynamic columns, stable order, missing-category zeros, missing-run dashes, and separate count and metric selectors.
- Through `Show.diff`, use table cases for positive, negative, and neutral valence with positive, negative, and zero differences. Check the resulting colors, including an explicit category color that differs from its valence default.
- Verify that `colorize: false` produces no ANSI sequences. Check meaningful cells and headers rather than snapshotting table borders.

## Task 4: Connect CLI filters, saved reports, and examples

Files:

- `workspace/tons-of-tests-cli/src/common.ts`
- `workspace/tons-of-tests-cli/src/summarize.ts`
- `workspace/tons-of-tests-cli/src/diff.ts`
- `workspace/tons-of-tests-cli/src/stats.ts`
- `workspace/tons-of-tests-cli/src/test-run.ts`
- `workspace/tons-of-tests-cli/src/test-report.spec.ts`
- `workspace/tons-of-tests-cli/src/saved-report.spec.ts`
- `workspace/tons-of-tests-cli/src/stats.spec.ts`
- `workspace/tons-of-tests-cli/src/diff.spec.ts`
- `workspace/examples/src/with-cli/custom-labels.ts` — add

Depends on: Task 3.

Changes:

- Let `--labels` accept the shared label schema, including custom names and mixtures such as `TP,failure-timeout`.
- Let a valid but absent name select no results.
- Keep filters scoped to reporting.
- Preserve the existing choice of the to-side label, or the from-side label for removed results.
- Pass `config.displayConfig` to every renderer. The stats and diff tables printed by `summarize` and `diff` currently omit it.
- Use the same settings for fresh, cached, and saved-run reports.
- When a category definition is removed, use neutral display for that label without hiding its stored results.
- Preserve `--exit-on-diff`: it responds to changed, added, or removed results. Valence does not change exit behavior.
- Add an example that catches one tagged Effect error and returns an output value described by a schema. Assign `failure-timeout` in `evaluate` and choose its color and negative valence.
- Update public JSDoc and CLI help where needed to explain custom labels, count selection, metrics, and display settings.

Tests:

- Through CLI commands, filter mixed labels and verify both visible rows and recomputed statistics. Include malformed labels and valid labels with no matching results.
- Exercise fresh, cached, and committed reports with custom labels. Check current and previous labels and per-category counts in summaries, diffs, and run overviews.
- Report the same snapshot with two display configurations. Check that appearance changes while stored labels, result IDs, comparison results, and snapshot bytes stay unchanged.
- Check custom-category changes with `--exit-on-diff`, including a change between two negative categories. The label change must still count as a difference.
- Use existing Effect test layers, scoped temporary resources, and real SQLite. Keep rendered-output assertions focused on the CLI’s reporting contract.

## Task 5: Check the complete change

Depends on: Tasks 1–4.

- Run the checks after all source, example, and test changes are in place.
- Preserve concurrent workspace edits when reviewing formatter changes.
- Run these commands from `/home/ts/dev/creative-introvert/tons-of-tests`:

```sh
direnv exec . just check-fix
direnv exec . just verify
```

Expected results:

- Formatting and lint checks pass.
- TypeScript accepts the library, CLI, tests, and examples.
- All unit and SQLite tests pass.
- Both publishable packages build.

Final review:

- Run the tests in Tasks 1–4 once through `just verify`. Add another run only when a failure or new change warrants it.
- Confirm that the final diff contains no runner error-recovery policy, saved presentation metadata, README/MIGRATION_GUIDE edits, or release changes.
