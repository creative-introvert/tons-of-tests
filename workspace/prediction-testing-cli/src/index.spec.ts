import * as t from '@effect/vitest';
import * as PT from '@creative-introvert/prediction-testing';

import * as P from './prelude.js';

const add = (input: number) => P.Effect.succeed(input + 1);

// t.describe('cli', () => {
//     t.effect('summarize', () =>
//         P.Effect.gen(function* () {
//             const name = 'summarize';
//
//             const t1 = {
//                 dbPath: 'summarize.db',
//                 testSuite: {
//                     testCases: [
//                         {input: 1, expected: 2},
//                         {input: 2, expected: 3},
//                         {input: 3, expected: 4},
//                     ],
//                     program: add,
//                     name,
//                 },
//             };
//
//             const r1 = yield* _sumarize({
//                 shouldRun: false,
//                 labels: P.Option.none(),
//                 config: t1,
//             });
//
//             yield* _commit({config: t1});
//
//             const t2 = {
//                 dbPath: 'summarize.db',
//                 testSuite: {
//                     testCases: [
//                         {input: 1, expected: 2},
//                         {input: 3, expected: 3},
//                         {input: 5, expected: 4},
//                     ],
//                     program: add,
//                     name,
//                 },
//             };
//
//             const r2 = yield* _sumarize({
//                 shouldRun: false,
//                 labels: P.Option.none(),
//                 config: t2,
//             });
//
//             const t3 = {
//                 dbPath: 'summarize.db',
//                 testSuite: {
//                     testCases: [
//                         {input: 1, expected: 2},
//                         {input: 4, expected: 3},
//                         {input: 7, expected: 4},
//                     ],
//                     program: add,
//                     name,
//                 },
//             };
//
//             const r3 = yield* _sumarize({
//                 shouldRun: false,
//                 labels: P.Option.none(),
//                 config: t2,
//             });
//         }).pipe(
//             P.Effect.tapError(e => P.Console.error(e)),
//             P.Effect.provide(PT.TestRepository.LiveLayer),
//             P.Effect.provide(PT.TestRepository.SqliteTestLayer),
//         ),
//     );
// });
