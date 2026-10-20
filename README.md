# tots (tons-of-tests)

A specialized test runner for predictive functions, focusing on scenarios where 100% accuracy isn't expected or practical. Similar to Jest, vitest, or ava, but designed specifically for testing search, auto-complete, ML models, and statistical functions.

## When to Use

✅ **Perfect for:**
- Large test suites comparing input/output pairs
- Statistical/ML model testing where perfect accuracy isn't possible
- Testing flaky legacy systems

❌ **Not recommended for:**
- Small, example-based test suites (use Jest/vitest instead)
- Tests requiring advanced mocking or spy functionality

## Key Design Notes

1. **Library-based**: Unlike Jest/vitest, tots is imported as a library rather than used as a standalone runtime
2. **Effect-based**: Requires [effect](https://effect.website/) as a dependency - your tested functions must return an [Effect](https://effect.website/docs/guides/essentials/the-effect-type)

> ⚠️ **Note**: This library is in alpha. Expect frequent breaking changes without warning. A beta phase with migration guidance is planned.

> 📖 **Upgrading to v1?** See [MIGRATION_GUIDE_V1.md](./MIGRATION_GUIDE_V1.md).

## Getting Started

Use Node.js 24 or newer and Effect 4. The Effect packages in this repository
use the same exact version. The SQLite driver uses Node's built-in SQLite.
This release requires a fresh database. Set `dbPath` to a new file and run the
suite again. Old database formats are not upgraded automatically.

### Installation

Install the required packages with your preferred package manager:

```bash
@creative-introvert/tons-of-tests
@creative-introvert/tons-of-tests-cli
effect
```

### Basic Example

Define your test suite:

```ts
// my-test-suite.ts
import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect, Schema} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 1.7);
const classify = Classify.makeClassify<number, number>({
    // Treat an absolute error of up to 0.4 as a match.
    isEqual: (a, b) => Math.abs(b - a) <= 0.4,
});

CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: [
            {input: 0, expected: 0},
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
            {input: 4, expected: 5},
        ],
        evaluate: (result, expected) => [
            {key: 'result', result, expected, label: classify(result, expected)},
        ],
        program: (input: number) => Effect.promise(() => myFunction(input)),
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 1,
});
```

Omit `evaluate` to compare the whole output with the expected value using
`Schema.toEquivalence`. Reuse the same schema instance for
`schemas.evaluation.result` and `schemas.evaluation.expected`. The default
evaluator returns one result with key `result`. It treats `null` and `undefined`
as missing values for classification.

`Classify.makeClassify` returns a label for one comparison. Use it inside
`evaluate` to choose other matching rules or compare values of different types.

The runner keeps the first case for each input/expected-value hash. It warns
and skips later duplicates before calling `program`, then continues the suite.
Tags do not change a case's identity; the first case's tags are kept.

`testCases` can also be an Effect `Stream`, which is useful for large or generated suites that are consumed lazily by the runner:

```ts
import {Stream} from 'effect';

CLI.run({
    testSuite: {
        name: 'with-cli-stream',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: Stream.fromIterable([
            {input: 0, expected: 0},
            {input: 1, expected: 2},
        ]),
        program: (input: number) => Effect.promise(() => myFunction(input)),
    },
    dbPath: 'with-cli-stream.db',
});
```

### Multiple Results From One Test Case

Use `evaluate` to track parts of one program output separately. The runner calls
`program` once per test case, then passes its output and the case's expected
value to `evaluate`.

For a BANT inference, the evaluator can return a result for each of budget,
authority, need, and timeline:

```ts
import {Classify, type Test} from '@creative-introvert/tons-of-tests';
import {Array, Schema} from 'effect';

const Field = Schema.NullOr(Schema.String);
const Bant = Schema.Struct({
    budget: Field,
    authority: Field,
    need: Field,
    timeline: Field,
});
type Bant = typeof Bant.Type;

const fields = ['budget', 'authority', 'need', 'timeline'] as const;
const classify = Classify.makeClassify({isEqual: Schema.toEquivalence(Field)});

const evaluate: Test.Evaluate<Bant, Bant, string | null, string | null> = (
    output,
    expected,
) =>
    Array.map(fields, key => ({
        key,
        result: output[key],
        expected: expected[key],
        label: classify(output[key], expected[key]),
    }));
```

Pass `evaluate` alongside `program` in the test suite. See the runnable
[multiple-results.ts example](./workspace/examples/src/with-cli/multiple-results.ts)
for a complete suite using a fixed response in place of an LLM call.

`evaluate` is a pure function. It must return a non-empty readonly array of
`Test.EvaluationResult` values. Each value has a `key`, `result`, `expected`, and
`label`. Keys must be non-empty and unique within the case. Keep keys stable
across runs so the CLI can match each result to its previous value.

The CLI shows one row per result in the existing table. Rows from the same case
stay next to each other and share the same `hash`. The `key` column identifies
each result. The hash comes from the original input and expected value; each
result is matched across runs by that hash and its key.

For the BANT example, these columns show the shared case hash (other columns
are omitted here):

```text
┌──────────┬───────────┬───────┐
│ hash     │ key       │ label │
├──────────┼───────────┼───────┤
│ 688c8d1f │ budget    │ FP    │
├──────────┼───────────┼───────┤
│ 688c8d1f │ authority │ TP    │
├──────────┼───────────┼───────┤
│ 688c8d1f │ need      │ TP    │
├──────────┼───────────┼───────┤
│ 688c8d1f │ timeline  │ FN    │
└──────────┴───────────┴───────┘
```

The statistics count cases and results separately. Labels, precision, and recall
count visible results. Timing statistics count each visible case once, even when
it has several result rows.

This suite needs a schema for the whole BANT expectation and schemas for the
individual field values:

```ts
const schemas = {
    testCase: {input: Schema.String, expected: Bant},
    evaluation: {result: Field, expected: Field},
};
```

### Value Schemas

Every suite requires `schemas`. The fields describe the values used at each
stage:

| Field | Value |
| --- | --- |
| `testCase.input` | Original input passed to `program` and saved with each result. |
| `testCase.expected` | Whole expected value passed to `evaluate` and used in the case hash. |
| `evaluation.result` | Result returned by `evaluate`. |
| `evaluation.expected` | Expected value returned by `evaluate`. |

The runner derives JSON codecs with Effect's `Schema.toCodecJson`. Built-in
schemas such as `Schema.BigInt` and `Schema.Date` provide JSON encodings.
Custom codecs can choose other encodings. Their encoded and decoded types may
differ. Schemas must not require Effect services.

`program`, `evaluate`, and fresh results keep the original values. Saved values
are encoded and loaded values are decoded with the same schemas. The whole
program output needs no storage schema when `evaluate` selects smaller values.

Encodings must be deterministic. The runner rejects undeclared object fields
and checks that decoding the JSON text restores an equivalent value according
to `Schema.toEquivalence`. These checks run before hashing or saving. For
example, an untagged bigint/string union can encode both `123n` and `"123"` as
the same JSON string. Use an encoding that records which type it contains.

Case hashes cover the encoded original input and whole expected value.
Result IDs also cover the evaluation key, label, and encoded result values.
Object keys are sorted; array order remains significant. Changing an encoding
can change hashes. Existing data is not migrated.

Tables and visual diffs display encoded JSON. Comparisons between runs use
schema equality on decoded values. Saved labels are not re-evaluated.

Conversion failures use `Error.TestValueError`. It includes the suite,
one-based case number, evaluation key when available, field, operation, and
original `SchemaError` cause. A failed CLI execution stays incomplete and cannot
be committed or reused with `--cached`.

Direct repository calls also require schemas:

```ts
yield* repository.withTestRun(
    run,
    repository.insertTestResults(results, run, schemas),
);
const saved = repository.getTestResultsStream(run, schemas);
```

`Show.summarize({testRun, schemas})` returns an Effect containing the table text.
`Show.prepareSummary(results, {schemas, suite})` prepares table chunks inside
`Effect.scoped`. Both report conversion failures in the Effect error channel.
The schema-free `Classify.defaultIsEqual` and `Test.makeSha256` exports have
been removed.

### CLI Commands

The CLI reads and compares results in batches. It writes formatted rows to a
temporary file, then reads them back to print the table with the correct column
widths. Timing statistics use temporary SQLite tables, including the exact
median. Temporary files and tables are removed after use or failure.

This avoids keeping both full runs and the full table text in JavaScript memory.
The runner still keeps one hash per distinct case to detect duplicates. Arrays
you supply as `testCases` also stay in memory; use a stream to read cases as
needed. Temporary storage grows with the report size. The existing commands,
flags, table layout, and statistics stay the same.

#### Summarize

```sh
pnpx tsx my-test-suite.ts summarize
```

#### Filter Results

Both `summarize` and `diff` accept these filters:

| Flag | Includes a result when… |
| --- | --- |
| `--keys budget,need` | Its key is `budget` or `need`. |
| `--labels FP,FN` | Its current label is `FP` or `FN`. |
| `--tags enterprise,german` | Its case has either tag. |
| `--all-tags enterprise,german` | Its case has both tags. |

Different flags combine with AND. For example, show budget errors from
enterprise cases:

```sh
pnpx tsx bant-suite.ts summarize --keys budget --labels FP,FN --tags enterprise
```

For the basic example, show matching results:

```sh
pnpx tsx my-test-suite.ts summarize --labels TP
```

Filters change the displayed rows and statistics. The CLI runs and saves all
evaluations before applying them, so filtering does not discard saved results
or reduce the number of program calls. No matches produces an empty view;
`summarize` also reports zero counts.

#### Summarize From Cache

After the whole suite finishes successfully, `--cached` reads its saved results
without re-running the program or evaluator. This also works for an empty
suite. If the previous attempt failed or was interrupted, the CLI clears its
partial results and runs the suite again.

Use the cache to inspect other keys without making another inference call:

```sh
pnpx tsx bant-suite.ts summarize --cached --keys budget,need
```

`diff --cached` behaves the same way for the current-run side of the diff.
The cache belongs to the suite name. It does not detect changes to the program
or test cases; omit `--cached` when you want to run them again.

After upgrading, use a fresh database and create a new baseline. See
[database setup](./MIGRATION_GUIDE_V1.md#database-setup).

#### Write Test Results

```bash
pnpx tsx my-test-suite.ts commit
```

`commit` saves the current results as the baseline for later comparisons.
It rejects a tracked run that failed or is still running. Changing the
baseline and creating the next current run happen in one database transaction.

#### Diff

The diff command compares your current test results with previously committed results. This is useful when you've made changes to either:

- Your test suite's inputs or expected values
- The implementation of the function being tested

```diff
diff --git a/my-test-suite.ts b/my-test-suite.ts
index 21cd713..ab1b6dc 100644
--- a/my-test-suite.ts
+++ b/my-test-suite.ts
@@ -1,7 +1,7 @@
 import * as CLI from '@creative-introvert/tons-of-tests-cli';
 import {Effect} from 'effect';
 
-const myFunction = (input: number) => Promise.resolve(input * 1.7);
+const myFunction = (input: number) => Promise.resolve(input * 2);
 
 CLI.run({
     testSuite: {
```

```sh
pnpx tsx my-test-suite.ts diff
# Exit with code 1 when the filtered view contains differences.
pnpx tsx my-test-suite.ts diff --exit-on-diff
```

For a suite with several results per case, select the keys to compare:

```sh
pnpx tsx bant-suite.ts diff --keys budget --labels FP,FN
```

`diff` matches results by case hash and key before applying filters. It includes
new results and changes to a result's value, expected value, or label. A current
`FP` result keeps its previous value and label even when that previous label
does not match `--labels`.

See [workspace/examples/src/with-cli](./workspace/examples/src/with-cli) for
more examples. From the repository root, run:

```sh
direnv exec . pnpm exec tsx workspace/examples/src/with-cli/simple-run.ts summarize
direnv exec . pnpm exec tsx workspace/examples/src/with-cli/simple-effect.ts
direnv exec . pnpm exec tsx workspace/examples/src/with-cli/multiple-results.ts summarize --keys budget,need
```

### Using the CLI programmatically

`CLI.run(config, args?)` is the process-entry helper. It parses `args ??
process.argv`, runs the CLI under `NodeRuntime.runMain`, and returns `void`:

```ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';

CLI.run(
    {
        testSuite,
        dbPath: 'with-cli-simple.db',
    },
    ['node', 'script', 'summarize'],
);
```

Use `CLI.effect(config, args?)` when another Effect application owns the
runtime or provides dependencies required by `testSuite.program`:

```ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {NodeRuntime} from '@effect/platform-node';
import {Effect} from 'effect';

CLI.effect(
    {
        testSuite,
        dbPath: 'with-cli-simple.db',
    },
    ['node', 'script', 'summarize'],
).pipe(
    Effect.provide(MyProgramLayer),
    NodeRuntime.runMain,
);
```

Each `CLI.effect` call opens and closes its own database connection. To share
one repository across several commands, use `CLI.effectNoDeps` and provide
the services once around the whole program. This also lets an in-memory
database keep its results between commands:

```ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {NodeRuntime} from '@effect/platform-node';
import {Effect} from 'effect';

const config = {testSuite, dbPath: ':memory:'};

Effect.gen(function* () {
    yield* CLI.effectNoDeps(config, ['node', 'script', 'summarize']);
    yield* CLI.effectNoDeps(config, ['node', 'script', 'commit']);
}).pipe(
    Effect.provide(CLI.buildLayer(config)),
    NodeRuntime.runMain,
);
```

`effectNoDeps` uses the supplied platform services and `TestRepository`.
Its `config.dbPath` is only used if you pass the config to `buildLayer`.

If you need the last committed test-run hash from inside another script, use
the dedicated helper:

```ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';

const hash = await CLI.getLastTestRunHash({
    testSuite,
    dbPath: 'with-cli-simple.db',
});
// hash: string | null
```

When you use `CLI.effect` or `CLI.effectNoDeps`, `diff --exit-on-diff` fails with a typed
`DiffNonEmpty` error when the current run has visible diffs. Handle it with
`Effect.catchTag('DiffNonEmpty', handler)`; `error.count` gives the number of
visible changed results.

At the process entry point (`CLI.run`), `DiffNonEmpty` is translated to
`process.exitCode = 1` — the user-facing "exit with code 1 on diff"
behavior is unchanged.

## Development

The repository uses pnpm 12, TypeScript 7, Vitest 5, and the Effect compiler
and linter tools. Install the pnpm version pinned in `package.json`.
`pnpm install` also patches TypeScript and Oxlint through the `prepare` hook.

Run project commands from the repository root through direnv:

```sh
direnv exec . pnpm install --frozen-lockfile
direnv exec . just
direnv exec . just check
direnv exec . just check-fix
direnv exec . just typecheck
direnv exec . just test
direnv exec . just build
direnv exec . just verify
```

`check` runs lint and format checks. `check-fix` applies fixes. `verify` also
checks types, runs tests, and builds both publishable packages. `test` accepts
Vitest arguments, such as `just test workspace/tons-of-tests-cli`.
Use `test-watch` or `typecheck-watch` while editing.

The root `tsconfig.json` builds the workspace projects. Each workspace keeps
tests and build scripts out of its production output. `tsconfig.tools.json`
checks tests and tooling, while `tsconfig.typecheck.json` checks all source
without writing JavaScript. The build writes ESM, CommonJS, and declarations
to each published package's `dist` directory.

Package scripts are kept for the existing GitHub Actions jobs, which do not
install Just. Just calls those same scripts where both need the same command.
Use `changeset`, `changeset-version`, and `changeset-publish` for releases.

Oxlint permits the Effect platform, SQL, CLI, and test APIs marked unstable;
their versions are pinned. `Stats` and `TestRun` keep their existing structural
types so callers can still pass matching objects. Other Effect lint checks
remain enabled. VS Code uses the patched workspace TypeScript compiler.

## Why No Runtime?

Most test runners like Jest and Vitest come with their own command-line interface (CLI). When you run `jest` or `vitest`, these tools automatically find your test files, execute them, and report results.

While convenient, this approach introduces significant complexity:

1. **Build System Complexity**: Modern JavaScript/TypeScript projects use various build tools and configurations. A test runner needs complex logic to handle:
   - TypeScript compilation with different configurations
   - Module systems (ESM vs CommonJS)
   - Framework-specific code (React, Svelte, etc.)
   - Custom babel/esbuild/swc configurations

2. **Framework vs Library Trade-offs**: Test runners like Jest are frameworks - they control the execution flow and call your code. This means:
   - The framework needs to provide many configuration options
   - Customization requires understanding framework internals
   - Extensions must fit within the framework's constraints

While we could integrate with existing test runners like Vitest, this would still impose their limitations and complexity.

Instead, `tots` is designed as a library that you import and use directly in your code. While this means writing a bit more boilerplate, it offers:
- Simpler implementation with fewer moving parts
- Full control over test execution
- Easy integration with your existing build tools
- Unlimited extensibility through normal JavaScript/TypeScript code
