# PERCOV

Percov (**Per**formance **Cov**erage) provides an alternative to test runners like [Jest](https://jestjs.io/) or [ava](https://github.com/avajs/ava).

Test runners like Jest focus on _individual_ test cases and promote
example-based testing, providing no insights on summary statistics like
precision and recall (without reaching for third-party reporters).

Percov, in contrast assumes, and provides tools for working with a large corpus
of test cases per suite.

## When you should use percov

- you have tons of test cases, and your tests purely compare
  inputs and outputs of the function under test
- you are testing a statistical model
- you are testing a (flaky) legacy system

## Getting Started
