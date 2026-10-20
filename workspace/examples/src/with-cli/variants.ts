import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect, Schema} from 'effect';

/**
 * Run from the project directory. Use a fresh database; older storage formats
 * are not migrated.
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize --variant A
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize --variant A --cached
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit --variant A
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize --variant B
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit --variant B
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --variant A
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --from A --to B
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts stats
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts runs --limit 50
 *
 * Replace 17 and 23 below with the IDs printed by summarize, diff, or runs.
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit --run run:17
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --from run:17 --to run:23
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts stats --runs run:23,A,run:17
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts runs --variant A --limit 50 --before 17
 *
 * A suite may define one program with the permanent variant ID `default`.
 * Running it does not need --variant. Named variants always need a selection.
 * Keep IDs stable: editing A keeps A's history; renaming it starts a new history.
 *
 * --cached reuses the latest attempt only if it is Complete, even if it is the
 * baseline. If the latest attempt is Running or Failed, execution starts a new run.
 * Reports are prepared after all results are saved. The run ID is printed before
 * report preparation, so it remains available if the report fails. A report failure
 * leaves the run Complete. Every execution gets its own ID. Complete and Failed
 * runs stay unchanged. Commit changes only the selected variant's baseline pointer.
 * Saved history is not pruned automatically.
 *
 * Saved run references read stored results without running a program. Removed
 * variants remain readable. All selected runs use this suite's shared codecs,
 * which must require no Effect services. You decide whether stored values still
 * mean the same thing. Program settings and versions are not recorded.
 * A missing baseline has no metrics; an empty complete run has zero counts.
 * Diff counts only visible changed, added, and removed rows. Stats counts all
 * selected results. Filters use each run's saved values and tags. In a diff,
 * filters use the `to` side when present and the `from` side for removed rows.
 *
 * If programs or the case stream need services, use CLI.effect and provide
 * those services before running the returned Effect.
 */
const classify = Classify.makeClassify<number, number>({
    isEqual: (a, b) => a === b,
});

CLI.run({
    dbPath: 'with-cli-variants.db',
    testSuite: {
        name: 'local-variants',
        schemas: {
            testCase: {input: Schema.Finite, expected: Schema.Finite},
            evaluation: {result: Schema.Finite, expected: Schema.Finite},
        },
        testCases: [
            {input: 1, expected: 2, tags: ['small']},
            {input: 2, expected: 4, tags: ['small']},
            {input: 4, expected: 8, tags: ['large']},
        ],
        variants: {
            A: {program: (input: number) => Effect.succeed(input * 2)},
            B: {program: (input: number) => Effect.succeed(input + 2)},
            C: {program: (input: number) => Effect.succeed(input * 3)},
        },
        evaluate: (result, expected) => [
            {key: 'value', result, expected, label: classify(result, expected)},
        ],
    },
});
