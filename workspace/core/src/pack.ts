import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as S from '@effect/schema/Schema';

const PackageJsonSchema = S.parseJson(
    S.struct({
        dependencies: S.record(S.string, S.string),
        license: S.string.pipe(S.nonEmpty()),
        name: S.string.pipe(S.nonEmpty()),
        repository: S.record(S.string, S.string),
        sideEffects: S.array(S.string),
        tags: S.array(S.string),
        version: S.string.pipe(S.nonEmpty()),
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
};

const main = async () => {};

void getPackageJson();
