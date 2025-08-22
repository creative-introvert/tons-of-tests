# @creative-introvert/tons-of-tests-cli

## 0.10.0

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
- Updated dependencies [7ae1130]
- Updated dependencies
  - @creative-introvert/tons-of-tests@0.9.0

## 0.9.3

### Patch Changes

- Updated dependencies [555df78]
  - @creative-introvert/tons-of-tests@0.8.0

## 0.9.2

### Patch Changes

- Chore: Update deps.
- Updated dependencies
  - @creative-introvert/tons-of-tests@0.7.2

## 0.9.1

### Patch Changes

- Docs: Update README.
- Updated dependencies
  - @creative-introvert/tons-of-tests@0.7.1

## 0.9.0

### Minor Changes

- Feat: Always return last test run hash.

### Patch Changes

- Updated dependencies
  - @creative-introvert/tons-of-tests@0.7.0

## 0.8.0

### Minor Changes

- Feat: Rework --run as --cached.

## 0.7.0

### Minor Changes

- Feat: Clearer progress.
  Feat: Add previous label column.
  Feat: Show stats in diff.
  Fix: Incorrect stats.

### Patch Changes

- Updated dependencies
  - @creative-introvert/tons-of-tests@0.6.0

## 0.6.1

### Patch Changes

- 5590533: Chore: Update deps.
- 8ed7ae2: Fix: Remove noisy log.
- Updated dependencies [5590533]
- Updated dependencies [8ed7ae2]
  - @creative-introvert/tons-of-tests@0.5.1

## 0.6.0

### Minor Changes

- eff0af7: Feat: Show stats even with empty results.

### Patch Changes

- Updated dependencies [d5a2803]
- Updated dependencies [9b7ee12]
  - @creative-introvert/tons-of-tests@0.5.0

## 0.5.1

### Patch Changes

- Fix: Properly clear stale runs.
- Updated dependencies
  - @creative-introvert/tons-of-tests@0.4.1

## 0.5.0

### Minor Changes

- Feat: Filter tags.

## 0.4.1

### Patch Changes

- Feat: Make concurrency optional.

## 0.4.0

### Minor Changes

- Refactor: Rename lib.

### Patch Changes

- Updated dependencies
  - @creative-introvert/tons-of-tests@0.4.0
