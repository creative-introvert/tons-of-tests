# @creative-introvert/tons-of-tests

## 0.9.0

### Minor Changes

- Feat: fix long-standing bug, biome, etc

  feat:

  - update dependencies, including effect
  - makeClassify takes a record instead of position args
    technically, this is a breaking change, but I doubt anyone is
    actually using this arg
  - remove the subscript "0" from cli labels, results, it was confusing

  fix:

  - longstanding issue where test runs would get "corrupted"
    the underlying issue was complicated: (1) summarize kept writing new
    test results to the current test run, without purging prior results,
    (2) commit would commit even without test results in the current
    run, and thus (3) clearing stale test runs would remove the wrong
    stuff

### Patch Changes

- 7ae1130: Chore: Bump dependencies.

## 0.8.0

### Minor Changes

- 555df78: Feat: Expose makeClassify and defaultIsNil

## 0.7.2

### Patch Changes

- Chore: Update deps.

## 0.7.1

### Patch Changes

- Docs: Update README.

## 0.7.0

### Minor Changes

- Feat: Always return last test run hash.

## 0.6.0

### Minor Changes

- Feat: Clearer progress.
  Feat: Add previous label column.
  Feat: Show stats in diff.
  Fix: Incorrect stats.

## 0.5.1

### Patch Changes

- 5590533: Chore: Update deps.
- 8ed7ae2: Fix: Remove noisy log.

## 0.5.0

### Minor Changes

- d5a2803: Feat: Total column.
- 9b7ee12: Feat: Show progress.

## 0.4.1

### Patch Changes

- Fix: Properly clear stale runs.

## 0.4.0

### Minor Changes

- Refactor: Rename lib.
