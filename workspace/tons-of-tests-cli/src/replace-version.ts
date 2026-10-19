import {NodeServices, NodeRuntime} from '@effect/platform-node';
import {Effect, FileSystem, Path, Schema} from 'effect';

const PackageVersion = Schema.fromJsonString(
    Schema.Struct({version: Schema.NonEmptyString}),
);

const replaceVersion = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dirname = path.dirname(
        yield* path.fromFileUrl(new URL(import.meta.url)),
    );
    const packageJson = yield* fs.readFileString(
        path.join(dirname, '../package.json'),
    );
    const {version} = yield* Schema.decodeEffect(PackageVersion)(packageJson);

    const filePath = path.join(dirname, './version.ts');
    yield* fs.writeFileString(
        filePath,
        `export const VERSION = '${version}';\n`,
    );
});

replaceVersion.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
