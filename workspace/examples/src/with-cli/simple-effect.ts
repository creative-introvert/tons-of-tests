import {Classify} from '@creative-introvert/tons-of-tests';
import * as CLI from '@creative-introvert/tons-of-tests-cli';
import {NodeRuntime} from '@effect/platform-node';
import {Context, Effect, Layer} from 'effect';

// A tiny service the program depends on. The CLI never knows about it —
// the caller is responsible for providing it before handing the Effect to
// a runtime.
class Scale extends Context.Tag('Scale')<Scale, {readonly factor: number}>() {}

const ScaleLive = Layer.succeed(Scale, {factor: 1.7});

const myFunction = (input: number) =>
    Effect.gen(function* () {
        const {factor} = yield* Scale;
        return input * factor;
    });

CLI.effect(
    {
        testSuite: {
            name: 'with-cli-simple-effect',
            testCases: [
                {input: 0, expected: 0},
                {input: 1, expected: 2},
                {input: 2, expected: 3},
                {input: 3, expected: 4},
                {input: 4, expected: 5},
            ],
            classify: Classify.makeClassify({
                isEqual: (a, b) => Math.abs(b - a) <= 0.4,
            }),
            program: myFunction,
        },
        dbPath: 'with-cli-simple.db',
        concurrency: 1,
    },
    // Args can be provided in memory to drive the CLI.
    // If not provided, falls back to `process.argv`.
    ['binary', 'filepath', 'summarize'],
).pipe(Effect.provide(ScaleLive), NodeRuntime.runMain);
