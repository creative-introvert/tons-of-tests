import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Schema, pipe} from 'effect';
import CSV from 'papaparse';

import {BiDirectionalRecord} from '../lib/BiDirectionalRecord.js';

// source: https://www.kaggle.com/datasets/fatemehmehrparvar/obesity-levels/data
// license: Attribution 4.0 International (CC BY 4.0)
const CAEC = Schema.Literal('no', 'Sometimes', 'Frequently', 'Always');
type CAEC = Schema.Schema.Type<typeof CAEC>;

const NObeyesdad = Schema.Literal(
    'Insufficient_Weight',
    'Normal_Weight',
    'Overweight_Level_I',
    'Overweight_Level_II',
    'Obesity_Type_I',
    'Obesity_Type_II',
    'Obesity_Type_III',
);
export type NObeyesdad = Schema.Schema.Type<typeof NObeyesdad>;

const RawObesityDataSchema = Schema.Struct({
    CAEC,
    NObeyesdad,
});

const eatBetweenMeals = Schema.Int;
const caecEatBetweenMeals = BiDirectionalRecord.fromLiterals(CAEC.literals);

const obesityLevel = Schema.Int;
const NObeyesdadObesityLevel = BiDirectionalRecord.fromLiterals(
    NObeyesdad.literals,
);

const TestDataSchema = Schema.Struct({
    eatBetweenMeals,
    obesityLevel,
});

const TestDataFromRawSchema = Schema.transform(
    RawObesityDataSchema,
    TestDataSchema,
    {
        encode: ({eatBetweenMeals, obesityLevel}) => ({
            CAEC: caecEatBetweenMeals.to[eatBetweenMeals],
            NObeyesdad: NObeyesdadObesityLevel.to[obesityLevel],
        }),
        decode: ({CAEC, NObeyesdad}) => ({
            eatBetweenMeals: caecEatBetweenMeals.from[CAEC],
            obesityLevel: NObeyesdadObesityLevel.from[NObeyesdad],
        }),
    },
);

const parse = Schema.decodeUnknownSync(Schema.Array(TestDataFromRawSchema));

export const createTestCases = async () => {
    const filePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        './obesity.csv',
    );

    return pipe(
        await fs.readFile(filePath, {encoding: 'utf8'}),
        _ =>
            CSV.parse(_, {
                header: true,
                comments: '#',
                skipEmptyLines: true,
            }),
        ({data}) => parse(data),
        xs =>
            xs.map(({eatBetweenMeals, obesityLevel}, i) => ({
                input: {
                    eatBetweenMeals,
                    // Tracking the index to avoid throwing out duplicate test cases.
                    i,
                },
                expected: obesityLevel,
            })),
    );
};
