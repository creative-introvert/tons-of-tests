import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

import {pack} from './internal/pack.js';

const workspacePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

void pack(workspacePath);
