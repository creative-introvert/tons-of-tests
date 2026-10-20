import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect, Schema} from 'effect';

/**
 * Run from the project directory. Use a fresh database; older storage formats
 * are not migrated.
 *
 * Run all variants, inspect the cached results, then save them as baselines:
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize --cached --tags small
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts stats --cached
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --cached
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit
 *
 * summarize, stats, and ordinary diff run fresh tests by default. They select all
 * configured variants in declaration order. Add --variant A to select only A:
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts summarize --variant A
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit --variant A
 *
 * --cached reuses each variant's latest attempt if it is Complete, including an
 * empty attempt. This deliberately reuses results even after program code changes.
 * A missing, Running, or Failed attempt reruns. It never falls back to an older
 * success or a committed baseline.
 *
 * Results are cached before reporting. Filters affect display only; commit saves
 * every result from each selected attempt. A report failure leaves complete cached
 * results available. An execution failure leaves that attempt unusable.
 *
 * Only commit writes snapshots. It never runs programs, and every selected attempt
 * must be complete before anything is saved. It saves the whole selection at once
 * and updates each variant's baseline. Repeating commit reuses the same snapshots.
 * Later executions replace cached attempts and leave saved snapshots unchanged.
 *
 * The default cache is .cache/tons-of-tests/<hash>.sqlite under the directory where
 * the command runs. It keeps only the latest attempt per snapshot database, suite,
 * and variant. Set cachePath to choose another filename, or :memory: to keep the
 * cache only for the repository layer's lifetime. Deleting this disposable cache
 * leaves committed snapshots and baselines intact.
 *
 * dbPath: ':memory:' still uses the disk cache by default. Separate CLI processes
 * in the same directory can reuse that cache, but do not share an in-memory baseline.
 * To keep an in-memory baseline across calls, provide one CLI.buildLayer around
 * several CLI.effectNoDeps calls.
 *
 * Read committed baselines and history without running programs:
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --from A --to B
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts stats --runs A,B
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts runs --limit 50
 *
 * Replace 17 and 23 below with snapshot IDs printed by commit or runs.
 * run:<id> always refers to a committed snapshot.
 *
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts commit --run run:17
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts diff --from run:17 --to run:23
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts stats --runs run:23,A,run:17
 * direnv exec . pnpm exec tsx workspace/examples/src/with-cli/variants.ts runs --variant A --limit 50 --before 17
 *
 * diff --from/--to and stats --runs require saved snapshots. Missing references fail
 * without running programs. These options cannot be combined with --variant or
 * --cached. commit --run restores the snapshot as its variant's baseline, requires
 * a snapshot from this suite, and cannot be combined with --variant.
 *
 * A single program uses the permanent variant ID `default`. Keep named IDs stable:
 * editing A keeps A's history; renaming it starts a new history. Default reports
 * include only configured variants. Saved references and runs can read snapshots
 * for removed variants. Saved history is not pruned automatically.
 *
 * All selected runs use this suite's shared codecs, which require no Effect services.
 * You decide whether stored values still mean the same thing. Program settings and
 * versions are not recorded.
 *
 * Ordinary diff shows results as added when no baseline exists. An empty complete
 * baseline is still a baseline and has zero counts. Diff statistics count visible
 * changed, added, and removed rows. Stats counts all filtered results, including
 * unchanged ones. Filters use each run's stored values and tags. In a diff,
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
