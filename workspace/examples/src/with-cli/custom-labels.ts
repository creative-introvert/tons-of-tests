import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {Effect, Schema} from 'effect';

class RequestTimedOut extends Schema.TaggedError<
    RequestTimedOut,
    {readonly brand: unique symbol}
>()('RequestTimedOut', {}) {}

const Output = Schema.Union([
    Schema.TaggedStruct('Answer', {value: Schema.String}),
    Schema.TaggedStruct('Timeout', {}),
]);
type Output = typeof Output.Type;

// A fixed failure makes this example runnable without an external service.
const request = (input: string): Effect.Effect<Output, RequestTimedOut> =>
    input === 'slow'
        ? Effect.fail(new RequestTimedOut())
        : Effect.succeed({_tag: 'Answer', value: input});

const program = (input: string) =>
    request(input).pipe(
        Effect.catchTag('RequestTimedOut', () =>
            Effect.succeed({_tag: 'Timeout'} as const),
        ),
    );
const classify = Classify.makeClassify({
    isEqual: (result: string, expected: string) => result === expected,
});

CLI.run({
    dbPath: 'with-cli-custom-labels.db',
    displayConfig: {
        // Negative means fewer results with this label is better.
        labels: {'failure-timeout': {color: 'magenta', valence: 'negative'}},
    },
    testSuite: {
        name: 'with-cli-custom-labels',
        testCases: [
            {input: 'hello', expected: 'hello'},
            {input: 'slow', expected: 'answer'},
        ],
        program,
        schemas: {
            testCase: {input: Schema.String, expected: Schema.String},
            evaluation: {result: Output, expected: Schema.String},
        },
        evaluate: (result, expected) => [
            {
                key: 'answer',
                result,
                expected,
                label:
                    result._tag === 'Timeout'
                        ? 'failure-timeout'
                        : classify(result.value, expected),
            },
        ],
    },
});
