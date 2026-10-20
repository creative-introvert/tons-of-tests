import {Classify, type Test} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Array, Effect, Schema} from 'effect';

const Field = Schema.NullOr(Schema.String);
const Bant = Schema.Struct({
    budget: Field,
    authority: Field,
    need: Field,
    timeline: Field,
});
type Bant = typeof Bant.Type;

const fields = ['budget', 'authority', 'need', 'timeline'] as const;
const classify = Classify.makeClassify({isEqual: Schema.toEquivalence(Field)});

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
            testCase: {input: Schema.String, expected: Bant},
            evaluation: {result: Field, expected: Field},
        },
    },
    dbPath: 'with-cli-multiple-results.db',
});
