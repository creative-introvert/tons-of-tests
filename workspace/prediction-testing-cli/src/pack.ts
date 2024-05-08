import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {pack} from '@creative-introvert/prediction-testing';

const workspacePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

void pack(workspacePath);
