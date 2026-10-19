import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@creative-introvert/tons-of-tests': fileURLToPath(
                new URL(
                    './workspace/tons-of-tests/src/index.ts',
                    import.meta.url,
                ),
            ),
            '@creative-introvert/tons-of-tests-cli': fileURLToPath(
                new URL(
                    './workspace/tons-of-tests-cli/src/index.ts',
                    import.meta.url,
                ),
            ),
        },
    },
    test: {
        reporters: ['dot'],
        silent: true,
        sequence: {concurrent: true},
        include: ['workspace/*/src/**/*.spec.ts'],
    },
});
