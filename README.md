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
Existing database files are migrated when opened. Previously stored results
receive the key `result`; their test case hashes stay the same.

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
import {Effect} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 1.7);
const classify = Classify.makeClassify<number, number>({
    // Treat an absolute error of up to 0.4 as a match.
    isEqual: (a, b) => Math.abs(b - a) <= 0.4,
});

CLI.run({
    testSuite: {
        name: 'with-cli-simple',
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
`Classify.defaultIsEqual`. The default evaluator returns one result with key
`result`. `Classify.makeClassify` returns a label for one comparison; use it
inside `evaluate` when you want to choose how values match.

`testCases` can also be an Effect `Stream`, which is useful for large or generated suites that are consumed lazily by the runner:

```ts
import {Stream} from 'effect';

CLI.run({
    testSuite: {
        name: 'with-cli-stream',
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
import {Array} from 'effect';

type Bant = {
    readonly budget: string | null;
    readonly authority: string | null;
    readonly need: string | null;
    readonly timeline: string | null;
};

const fields = ['budget', 'authority', 'need', 'timeline'] as const;
const classify = Classify.makeClassify({isEqual: Classify.defaultIsEqual});

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

If you supply `testSuite.schemas`, `input` describes the original input.
`result` and `expected` describe the values returned by `evaluate`. For this
BANT example, both use `Schema.NullOr(Schema.String)` because each result is one
field, even though the program returns a full BANT object.

#### Updating Suites That Use `classify`

Replace the suite's `classify` property with an `evaluate` callback. Keep the
classifier and wrap its label in a result, as shown in the basic example:

```ts
evaluate: (result, expected) => [
    {key: 'result', result, expected, label: classify(result, expected)},
],
```

Suites that use the default comparison and omit `classify` need no changes.
Cached results keep their saved values and labels. Run the suite again after
changing `evaluate` to produce new results.

The same `schemas` decode current and previous runs. If you change the stored
result or expected-value shape and your schemas cannot read older values, use
a new suite name for the new shape.

### CLI Commands

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

When results for the current run are already saved, `--cached` reads them
without re-running the program or evaluator. If no cached results exist, it
runs and saves the suite. After the first run, use it to inspect other keys
without making another inference call:

```sh
pnpx tsx bant-suite.ts summarize --cached --keys budget,need
```

`diff --cached` behaves the same way for the current-run side of the diff.

#### Write Test Results

```bash
pnpx tsx my-test-suite.ts commit
```

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

When you use `CLI.effect`, `diff --exit-on-diff` fails with a typed
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
