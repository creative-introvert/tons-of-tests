import {NodeServices} from '@effect/platform-node';
import {Console, Effect, FileSystem, Path, Schema} from 'effect';

const PackageJsonSchema = Schema.fromJsonString(
    Schema.Struct({
        dependencies: Schema.Record(Schema.String, Schema.String),
        license: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
        name: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
        repository: Schema.Record(Schema.String, Schema.String),
        engines: Schema.Struct({node: Schema.String}),
        sideEffects: Schema.Array(Schema.String),
        tags: Schema.Array(Schema.String),
        version: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
    }),
);

export const pack = (workspacePath: string): Promise<void> =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const distPath = path.join(workspacePath, 'dist');
        const buildPath = path.join(workspacePath, 'build');
        const pjsonPath = path.join(workspacePath, 'package.json');
        const readmePath = path.join(workspacePath, '../../README.md');

        yield* fs.makeDirectory(distPath, {recursive: true});
        const pjson = yield* Schema.decodeEffect(PackageJsonSchema)(
            yield* fs.readFileString(pjsonPath),
        );

        const next = Object.assign(pjson, {
            type: 'module',
            files: ['dist/**/*'],
            main: './dist/cjs/index.js',
            module: './dist/esm/index.js',
            types: './dist/dts/index.d.ts',
            exports: {
                '.': {
                    types: './dist/dts/index.d.ts',
                    import: './dist/esm/index.js',
                    default: './dist/cjs/index.js',
                },
            },
            publishConfig: {access: 'public'},
        });

        yield* fs.writeFileString(
            path.join(distPath, 'package.json'),
            JSON.stringify(next, null, 2),
        );
        yield* Console.log('created package.json');

        yield* fs.copy(buildPath, path.join(distPath, 'dist'));
        yield* fs.writeFileString(
            path.join(distPath, 'dist/cjs/package.json'),
            JSON.stringify({type: 'commonjs'}),
        );
        yield* Console.log('copied build');

        yield* fs.copyFile(readmePath, path.join(distPath, 'README.md'));
        yield* Console.log('copied README');
    }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);
