import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as P from '../src/prelude.js';
import {version} from '../package.json';

const replaceVersion = P.Effect.gen(function* () {
    const fs = yield* P.FS.FileSystem;
    const dirname = path.dirname(fileURLToPath(import.meta.url));

    const filePath = path.join(dirname, `./version.ts`);
    yield* fs.writeFileString(filePath, `export const VERSION = '${version}';`);
});

replaceVersion.pipe(
    P.Effect.provide(P.NodeContext.layer),
    P.NodeRuntime.runMain,
);
