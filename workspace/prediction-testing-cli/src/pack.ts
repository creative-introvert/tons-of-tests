import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as S from '@effect/schema/Schema';

const PackageJsonSchema = S.parseJson(
    S.Struct({
        dependencies: S.Record(S.String, S.String),
        license: S.String.pipe(S.nonEmpty()),
        name: S.String.pipe(S.nonEmpty()),
        repository: S.Record(S.String, S.String),
        sideEffects: S.Array(S.String),
        tags: S.Array(S.String),
        version: S.String.pipe(S.nonEmpty()),
    }),
);

const getPackageJson = async () => {
    const workspacePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );
    const distPath = path.join(workspacePath, 'dist');
    const buildPath = path.join(workspacePath, 'build');
    const pjsonPath = path.join(workspacePath, 'package.json');
    const readmePath = path.join(workspacePath, '../../README.md');

    await fs.mkdir(distPath, {recursive: true});
    const pjson = S.decodeSync(PackageJsonSchema)(
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

void getPackageJson();
