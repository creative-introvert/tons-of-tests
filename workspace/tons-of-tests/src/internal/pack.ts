import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as Schema from 'effect/Schema';

const PackageJsonSchema = Schema.parseJson(
    Schema.Struct({
        dependencies: Schema.Record({key: Schema.String, value: Schema.String}),
        license: Schema.String.pipe(Schema.nonEmptyString()),
        name: Schema.String.pipe(Schema.nonEmptyString()),
        repository: Schema.Record({key: Schema.String, value: Schema.String}),
        sideEffects: Schema.Array(Schema.String),
        tags: Schema.Array(Schema.String),
        version: Schema.String.pipe(Schema.nonEmptyString()),
    }),
);

export const pack = async (workspacePath: string) => {
    const distPath = path.join(workspacePath, 'dist');
    const buildPath = path.join(workspacePath, 'build');
    const pjsonPath = path.join(workspacePath, 'package.json');
    const readmePath = path.join(workspacePath, '../../README.md');

    await fs.mkdir(distPath, {recursive: true});
    const pjson = Schema.decodeSync(PackageJsonSchema)(
        await fs.readFile(pjsonPath, {encoding: 'utf-8'}),
    );

    const next = Object.assign(pjson, {
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

    await fs.writeFile(
        path.join(distPath, 'package.json'),
        JSON.stringify(next, null, 4),
    );
    console.log('created package.json');

    await fs.cp(buildPath, path.join(distPath, 'dist'), {recursive: true});
    console.log('copied build');

    await fs.cp(readmePath, path.join(distPath, 'README.md'));
    console.log('copied README');
};
