import * as t from 'vitest';
import {Effect, Option, Stream} from 'effect';

import {Stats} from '../Classify.js';
import type {TestResult} from '../Test.js';
import type {TestRun} from '../Test.repository.js';
import {diff, makeSha256, runCollectRecord} from './Test.js';

const run: TestRun = {id: 1, name: 'suite', hash: null} as TestRun;

type AnyResult = TestResult<number, number | null, number | null>;

const mkResult = <R = number, E = number>(args: {
    input: number;
    expected: E;
    result: R;
    label: TestResult['label'];
    timeMillis: number;
    ordering?: number;
}): TestResult<number, R, E> => ({
    id: makeSha256(args),
    hashTestCase: makeSha256({input: args.input, expected: args.expected}),
    ordering: args.ordering ?? 0,
    input: args.input,
    result: args.result,
    expected: args.expected,
    label: args.label,
    tags: [],
    timeMillis: args.timeMillis,
});

const mkFN = (args: {
    input: number;
    expected: number;
    timeMillis: number;
    ordering?: number;
}): AnyResult => mkResult<null, number>({...args, result: null, label: 'FN'});

const mkTN = (args: {
    input: number;
    timeMillis: number;
    ordering?: number;
}): AnyResult =>
    mkResult<null, null>({...args, expected: null, result: null, label: 'TN'});

const collect = (results: readonly AnyResult[]) =>
    Stream.fromIterable(results).pipe(runCollectRecord(run), Effect.runPromise);

t.describe('runCollectRecord', () => {
    t.test('empty stream -> empty stats with none-options', async () => {
        const out = await collect([]);
        t.expect(out.stats.total).toBe(0);
        t.expect(out.stats.precision).toBe(0);
        t.expect(out.stats.recall).toBe(0);
        t.expect(out.stats.timeMin).toStrictEqual(Option.none());
        t.expect(out.stats.timeMax).toStrictEqual(Option.none());
        t.expect(out.stats.timeMean).toStrictEqual(Option.none());
        t.expect(out.stats.timeMedian).toStrictEqual(Option.none());
        t.expect(out.testCaseHashes).toStrictEqual([]);
        t.expect(out.testResultsByTestCaseHash).toStrictEqual({});
    });

    t.test(
        'mixed labels -> correct counts, precision, recall, time stats',
        async () => {
            const results: AnyResult[] = [
                mkResult({
                    input: 1,
                    expected: 1,
                    result: 1,
                    label: 'TP',
                    timeMillis: 10,
                }),
                mkResult({
                    input: 2,
                    expected: 2,
                    result: 2,
                    label: 'TP',
                    timeMillis: 20,
                }),
                mkResult({
                    input: 3,
                    expected: 3,
                    result: 4,
                    label: 'FP',
                    timeMillis: 30,
                }),
                mkFN({input: 4, expected: 4, timeMillis: 40}),
                mkTN({input: 5, timeMillis: 50}),
            ];
            const out = await collect(results);
            t.expect(out.stats.TP).toBe(2);
            t.expect(out.stats.FP).toBe(1);
            t.expect(out.stats.FN).toBe(1);
            t.expect(out.stats.TN).toBe(1);
            t.expect(out.stats.total).toBe(5);
            t.expect(out.stats.precision).toBeCloseTo(2 / 3);
            t.expect(out.stats.recall).toBeCloseTo(2 / 3);
            t.expect(Option.getOrThrow(out.stats.timeMin)).toBe(10);
            t.expect(Option.getOrThrow(out.stats.timeMax)).toBe(50);
            t.expect(Option.getOrThrow(out.stats.timeMean)).toBeCloseTo(30);
            t.expect(Option.getOrThrow(out.stats.timeMedian)).toBe(30);
        },
    );

    // Dedup invariant — {input, expected} collapses into one entry, but
    // `testCaseHashes` keeps the full ordering list. Easy to break if
    // someone "simplifies" the map later.
    t.test(
        'duplicate hashTestCase keeps one entry, hashes-array preserves length',
        async () => {
            const a = mkResult({
                input: 1,
                expected: 1,
                result: 1,
                label: 'TP',
                timeMillis: 1,
                ordering: 0,
            });
            const b = mkResult({
                input: 1,
                expected: 1,
                result: 2,
                label: 'FP',
                timeMillis: 2,
                ordering: 1,
            });
            const out = await collect([a, b]);
            t.expect(Object.keys(out.testResultsByTestCaseHash)).toHaveLength(
                1,
            );
            t.expect(out.testCaseHashes).toHaveLength(2);
            // last-write-wins
            t.expect(out.testResultsByTestCaseHash[a.hashTestCase].label).toBe(
                'FP',
            );
        },
    );
});

t.describe('Test.diff', () => {
    const mkStats = (overrides: Partial<Stats>) =>
        new Stats({...Stats.empty(), ...overrides});

    const mkRunResults = (stats: Stats) => ({
        ...run,
        stats,
        testCaseHashes: [],
        testResultsByTestCaseHash: {},
    });

    t.test.each([
        {
            description: 'no previous run -> returns raw stats',
            previous: Option.none<ReturnType<typeof mkRunResults>>(),
            current: mkStats({TP: 3, FP: 1, precision: 0.75, recall: 0.5}),
            expected: {
                TP: 3,
                FP: 1,
                TN: 0,
                FN: 0,
                precision: 0.75,
                recall: 0.5,
            },
        },
        {
            description: 'with previous -> field-by-field delta',
            previous: Option.some(
                mkRunResults(
                    mkStats({
                        TP: 1,
                        FP: 1,
                        TN: 1,
                        FN: 1,
                        precision: 0.5,
                        recall: 0.5,
                    }),
                ),
            ),
            current: mkStats({
                TP: 3,
                FP: 0,
                TN: 2,
                FN: 1,
                precision: 1,
                recall: 0.75,
            }),
            expected: {
                TP: 2,
                FP: -1,
                TN: 1,
                FN: 0,
                precision: 0.5,
                recall: 0.25,
            },
        },
    ])('$description', ({previous, current, expected}) => {
        const testRun = mkRunResults(current);
        const out = diff({testRun, previousTestRun: previous});
        t.expect(out).toMatchObject(expected);
    });
});
