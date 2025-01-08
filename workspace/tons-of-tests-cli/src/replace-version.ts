import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import { FileSystem } from '@effect/platform';

const getVersion = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.join(dirname, '../package.json');
    const packageJson = yield* fs.readFileString(packagePath);
    return JSON.parse(packageJson).version as string;
});

const replaceVersion = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const version = yield* getVersion;

    const filePath = path.join(dirname, `./version.ts`);
    yield* fs.writeFileString(filePath, `export const VERSION = '${version}';`);
});

replaceVersion.pipe(
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain,
);
