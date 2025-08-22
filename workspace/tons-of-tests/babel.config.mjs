/** @type {import('@babel/core')} */
const config = {
    plugins: [
        '@babel/transform-export-namespace-from',
        '@babel/transform-modules-commonjs',
    ],
    sourceMaps: true,
};

export default config;
