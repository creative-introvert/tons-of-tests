import {ConfigProvider} from 'effect';
import {Args, Command, Options} from '@effect/cli';

import * as P from './prelude.js';

const summarize = Command.make('summarize', {
    file: Args.text({name: 'file'}).pipe(
        Args.withDescription('Path to the test file, e.g. "./src/foo.test.ts"'),
    ),
});

const cli = Command.run(
    Command.make('prediction-testing').pipe(
        Command.withSubcommands([summarize]),
    ),
    {
        name: 'Prediction Testing',
        // FIXME
        version: 'v0.0.1',
    },
);

P.E.suspend(() => cli(process.argv)).pipe(
    P.E.provide(P.NodeContext.layer),
    P.NodeRuntime.runMain,
);
