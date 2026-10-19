export default {
    plugins: ['annotate-pure-calls'],
    env: {
        cjs: {
            plugins: [
                '@babel/transform-export-namespace-from',
                '@babel/transform-modules-commonjs',
            ],
        },
    },
    sourceMaps: true,
};
