import {Classify, type Test} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Array, Effect, Schema} from 'effect';

type Bant = {
    readonly budget: string | null;
    readonly authority: string | null;
    readonly need: string | null;
    readonly timeline: string | null;
};

const fields = ['budget', 'authority', 'need', 'timeline'] as const;
const classify = Classify.makeClassify({isEqual: Classify.defaultIsEqual});

const evaluate: Test.Evaluate<Bant, Bant, string | null, string | null> = (
    output,
    expected,
) =>
    Array.map(fields, key => ({
        key,
        result: output[key],
        expected: expected[key],
        label: classify(output[key], expected[key]),
    }));

// A fixed response keeps this example runnable without an LLM service.
const inferBant = (_transcript: string): Effect.Effect<Bant> =>
    Effect.succeed({
        budget: '5000 EUR',
        authority: 'CFO',
        need: 'CRM',
        timeline: null,
    });

CLI.run({
    testSuite: {
        name: 'with-cli-multiple-results',
        testCases: [
            {
                input: 'The CFO approved 50000 EUR for a CRM. We need it by December.',
                expected: {
                    budget: '50000 EUR',
                    authority: 'CFO',
                    need: 'CRM',
                    timeline: 'December',
                },
                tags: ['enterprise'],
            },
        ],
        program: inferBant,
        evaluate,
        schemas: {
            input: Schema.String,
            result: Schema.NullOr(Schema.String),
            expected: Schema.NullOr(Schema.String),
        },
    },
    dbPath: 'with-cli-multiple-results.db',
});
