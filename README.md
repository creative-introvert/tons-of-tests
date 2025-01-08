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

## Getting Started

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

The diff command compares your current test results with previously committed results. This is useful when you've made changes to either:
- Your test suite's inputs or expected values
- The implementation of the function being tested

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
