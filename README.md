# prediction-testing

`prediction-testing` is a test runner, simlar to [Jest](https://jestjs.io/), [vitest](https://vitest.dev/) or [ava](https://github.com/avajs/ava), that focuses on testing predictive functions (e.g. search, auto-complete, or ML).

## When you SHOULD use `prediction-testing`

- you have tons of test cases, and your tests purely compare inputs and outputs of the function under test
- you are testing a statistical model, or a predictive function, where 100% successful test results are impossible or impractical
- you are testing a (flaky) legacy system

## When you SHOULD NOT use `prediction-testing`

- when your tests are few, and predominantely example-based; use the conventional test runners instead (jest, ava, vitest)

## Getting Started
## Examples

Checkout `workspace/examples` for more examples.

```bash
pnpx tsx <file-path>
# e.g.
pnpx tsx ./workspace/examples/src/as-library.ts
```

## TODO

- Test previous input comparison.
- CLI is missing.
- Basic performance measurements.
