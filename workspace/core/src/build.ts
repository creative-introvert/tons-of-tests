import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as S from '@effect/schema/Schema';
import appRootDir from 'app-root-path';

const PackageJsonSchema = S.parseJson(
    S.struct({
        name: S.string.pipe(S.nonEmpty()),
        repository: S.record(S.string, S.string),
        version: S.string.pipe(S.nonEmpty()),
        license: S.string.pipe(S.nonEmpty()),
        tags: S.array(S.string),
        sideEffects: S.array(S.string),
        dependencies: S.record(S.string, S.string),
    }),
);

const getPackageJson = async () => {
    const rootPath = appRootDir.toString();
    const workspacePath = path.join(rootPath, 'workspace/core');
    const distPath = path.join(workspacePath, 'dist');
    const buildPath = path.join(workspacePath, 'build');
    const pjsonPath = path.join(workspacePath, 'package.json');

    await fs.mkdir(distPath, {recursive: true});
    const f = await fs.readFile(pjsonPath, {encoding: 'utf-8'});

    const pjson = S.decodeSync(PackageJsonSchema)(f);
    const next = Object.assign(pjson, {
        files: ['build/**/*'],
        main: './build/cjs/src/index.js',
        module: './build/esm/src/index.js',
        types: './build/dts/src/index.d.ts',
        publishConfig: {
            access: 'public',
        },
    });

    await fs.writeFile(
        path.join(distPath, 'package.json'),
        JSON.stringify(next, null, 4),
    );
    console.log('created package.json');
    await fs.cp(buildPath, path.join(distPath, 'build'), {recursive: true});
    console.log('copied build');
};

void getPackageJson();
