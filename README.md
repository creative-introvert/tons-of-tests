# tots (tons-of-tests)

`tons-of-test`, (or `tots` for short, ) is a test runner, simlar to [Jest](https://jestjs.io/), [vitest](https://vitest.dev/) or [ava](https://github.com/avajs/ava), that focuses on testing predictive functions (e.g. search, auto-complete, or ML).

## When you SHOULD use `tots`

- you have tons of test cases, and your tests purely compare inputs and outputs of the function under test
- you are testing a statistical model, or a predictive function, where 100% successful test results are impossible or impractical
- you are testing a (flaky) legacy system

## When you SHOULD NOT use `tots`

- when your tests are few, and predominantely example-based; use the conventional test runners instead (jest, ava, vitest)
- when you require your testing framework to do all sorts of magic (auto-mocking, spies, etc)

## Before Getting Started

Before looking at code examples, some notes on the design:

1. Unlike tools like jest or vitest, tots's CLI does not provide a
   runtime, but is imported as a library. Check the ["Why No Runtime?" section](#why-no-runtime)
   on the reasoning.
2. Though only required minimally, the library depends on using
   [effect](https://effect.website/) (the missing standard library for
   TypeScript). At minimum, your function under test has to return an [Effect](https://effect.website/docs/guides/essentials/the-effect-type).
   If your function doesn't already do so, checkout the [Usage](#usage) below, to see how to trivially convert it.

Further, a cautionary note on stability:

- The library is still in alpha, and will, regularly, without warning, release
  breaking changes.
- A beta phase is planned, which will keep releasing breaking changes, but
  provide guidance on migration paths, or even code-mods for automatic
  migration.

## Usage

With your package manager of choice, install the following packages:

```bash
@creative-introvert/tons-of-tests
@creative-introvert/tons-of-tests-cli
effect
```

The examples use `pnpm` and `pnpx` +  `tsx` to execute the files. Replace with
whatever you use in your setup (e.g. `npm` and `ts-node`, or `yarn` and `tsc +
node`, etc.)

### With CLI

Define your test-suite.

```ts
// my-test-suite.ts
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect} from 'effect';

const myFunction = (input: number) => Promise.resolve(input * 1.7);

void CLI.run({
    testSuite: {
        name: 'with-cli-simple',
        testCases: [
            {input: 0, expected: 0},
            {input: 1, expected: 2},
            {input: 2, expected: 3},
            {input: 3, expected: 4},
            {input: 4, expected: 5},
        ],
        program: (input: number) => Effect.promise(() => myFunction(input)),
    },
    dbPath: 'with-cli-simple.db',
    concurrency: 10,
});
```

#### Summarize

```
pnpx tsx my-test-suite.ts summarize

┌───────────────────────────────────────────────────────────────────────────┐
│ SUMMARY                                                                   │
├─────┬──────────┬────────┬──────┬───────┬──────────┬────────┬──────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 1/5 │ bd04cb2c │ 0.69ms │      │ 0     │ 0        │ TP     │              │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 2/5 │ 562e2cca │ 0.36ms │      │ 1     │ 2        │ FP     │ 2 => 1.7     │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 3/5 │ a5afd52f │ 3.30ms │      │ 2     │ 3        │ FP     │ 3 => 3.4     │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 4/5 │ 5f7f8725 │ 1.19ms │      │ 3     │ 4        │ FP     │ 4 => 5.1     │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 5/5 │ 6cc26923 │ 1.22ms │      │ 4     │ 5        │ FP     │ 5 => 6.8     │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │
└─────┴──────────┴────────┴──────┴───────┴──────────┴────────┴──────────────┘


┌────────────────────────────────────────────────────────────────────┐
│ STATS                                                              │
├───┬────┬────┬────┬────┬───────────┬────────┬──────────┬────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ 5 │ 1  │ 0  │ 4  │ 0  │ 0.20      │ 1.00   │ 1.35ms   │ 1.19ms     │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
└───┴────┴────┴────┴────┴───────────┴────────┴──────────┴────────────┘
```

#### Summarize With Labels Filter

```
pnpx tsx my-test-suite.ts summarize --labels TP

┌───────────────────────────────────────────────────────────────────────────┐
│ SUMMARY                                                                   │
├─────┬──────────┬────────┬──────┬───────┬──────────┬────────┬──────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ 1/1 │ bd04cb2c │ 0.52ms │      │ 0     │ 0        │ TP     │              │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │
└─────┴──────────┴────────┴──────┴───────┴──────────┴────────┴──────────────┘


┌────────────────────────────────────────────────────────────────────┐
│ STATS                                                              │
├───┬────┬────┬────┬────┬───────────┬────────┬──────────┬────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ 5 │ 1  │ 0  │ 4  │ 0  │ 0.20      │ 1.00   │ 1.23ms   │ 1.28ms     │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
└───┴────┴────┴────┴────┴───────────┴────────┴──────────┴────────────┘
```

#### Write Test Results

```bash
pnpx tsx my-test-suite.ts commit
```

#### Diff

Assuming you have (1) previous test results, and (2) something changed, e.g. the
inputs/expecations of your test suite, or the function-under-test
implementation.

```diff
diff --git a/my-test-suite.ts b/my-test-suite.ts
index 21cd713..ab1b6dc 100644
--- a/my-test-suite.ts
+++ b/my-test-suite.ts
@@ -1,7 +1,7 @@
 import * as CLI from '@creative-introvert/tots-cli';
 import {Effect} from 'effect';
 
-const myFunction = (input: number) => Promise.resolve(input * 1.7);
+const myFunction = (input: number) => Promise.resolve(input * 2);
 
 void CLI.run({
     testSuite: {
```

```
pnpx tsx my-test-suite.ts diff
# or, if you want it to process.exit(1) on diff
pnpx tsx my-test-suite.ts diff --exit-on-diff

┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ SUMMARY                                                                                             │
├─────┬──────────┬────────┬──────┬───────┬──────────┬────────┬──────────────┬─────────┬───────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │ label₋₁ │ diff result₋₁ │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┼─────────┼───────────────┤
│ 1/4 │ 562e2cca │ 0.23ms │      │ 1     │ 2        │ TP     │              │ FP      │ 2 => 1.7      │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┼─────────┼───────────────┤
│ 2/4 │ a5afd52f │ 3.66ms │      │ 2     │ 3        │ FP     │ 3 => 4       │ FP      │ 3 => 3.4      │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┼─────────┼───────────────┤
│ 3/4 │ 5f7f8725 │ 1.19ms │      │ 3     │ 4        │ FP     │ 4 => 6       │ FP      │ 4 => 5.1      │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┼─────────┼───────────────┤
│ 4/4 │ 6cc26923 │ 0.98ms │      │ 4     │ 5        │ FP     │ 5 => 8       │ FP      │ 5 => 6.8      │
├─────┼──────────┼────────┼──────┼───────┼──────────┼────────┼──────────────┼─────────┼───────────────┤
│ #/∑ │ hash     │ ms     │ tags │ input │ expected │ label₀ │ diff result₀ │ label₋₁ │ diff result₋₁ │
└─────┴──────────┴────────┴──────┴───────┴──────────┴────────┴──────────────┴─────────┴───────────────┘


┌────────────────────────────────────────────────────────────────────┐
│ STATS                                                              │
├───┬────┬────┬────┬────┬───────────┬────────┬──────────┬────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ 5 │ 2  │ 0  │ 3  │ 0  │ 0.40      │ 1.00   │ 1.30ms   │ 0.98ms     │
├───┼────┼────┼────┼────┼───────────┼────────┼──────────┼────────────┤
│ ∑ │ TP │ TN │ FP │ FN │ precision │ recall │ timeMean │ timeMedian │
└───┴────┴────┴────┴────┴───────────┴────────┴──────────┴────────────┘


┌────────────────────────────────────────┐
│ DIFF                                   │
├────┬────┬────┬────┬───────────┬────────┤
│ TP │ TN │ FP │ FN │ precision │ recall │
├────┼────┼────┼────┼───────────┼────────┤
│ 1  │ 0  │ -1 │ 0  │ 0.20      │ 0.00   │
├────┼────┼────┼────┼───────────┼────────┤
│ TP │ TN │ FP │ FN │ precision │ recall │
└────┴────┴────┴────┴───────────┴────────┘
```

Checkout `workspace/examples/src/with-cli` for more examples.

```
pnpx tsx <file-path>
# e.g.
pnpx tsx ./workspace/examples/src/with-cli/simple.ts
```


Checkout `workspace/examples` for more examples.

```bash
pnpx tsx <file-path>
# e.g.
pnpx tsx ./workspace/examples/src/with-cli/simple.ts
```

## Why No Runtime?

Tools like jest and vitest provide a dedicated CLI, which the user can run,
separately from other entrypoints into their app. For example, jest provides
the `jest` binary, which, magically, finds all the test files, and executes
them, reporting on the results.

Unfortunately, this comes with a lot of complexity:

1. Unless the user provides their tests as ES5 JavaScript (not a thing these
   days), jest has to figure out how transpile/compile the source. Given the
   level of, let's call it, variation in JavaScript land (Typescript, and its
   many different configurations, custom runtimes like svelte, ESM vs CommonJS,
   etc), this is no easy feat. The code required for enabling this would easily
   overshadow the actual test runner in terms of complexity.
2. As `jest` (etc) essentially behave as a _framework_ (jest calls _your_ code)
   as opposed to a _library_ (you call jest), customization requires additional
   complexity in the framework, which now has to provide various entrypoints
   into its execution.

Alternatively, the library could hook into an existing test runner (I've seen
that vite provides some programatic context), but I have not yet looked deeper
into that. Though saving me from solving this problem myself, this would likely
come with its own limitations.

Providing `tots` as a library is maybe not as satisfying and
convenient as a dedicated binary, but is **vastly** simpler, and far more
powerful, enabling trivial extensibility for the user.
