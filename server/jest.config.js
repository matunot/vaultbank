/**
 * Jest config for the server tests.
 *
 * We map `uuid` (v14 is ESM-only) to a tiny CJS shim, and tell Jest
 * to transform nothing in node_modules.
 */
module.exports = {
    testEnvironment: 'node',
    rootDir: __dirname,
    testMatch: ['<rootDir>/__tests__/**/*.test.js'],
    moduleNameMapper: {
        // Jest cannot `require()` the ESM-only uuid@14 build, so swap
        // it out for a tiny CJS shim that returns a deterministic v4.
        '^uuid$': '<rootDir>/__tests__/__uuid_shim__.js',
    },
    transformIgnorePatterns: ['/node_modules/'],
    setupFiles: ['<rootDir>/__tests__/setup.js'],
    testTimeout: 20000,
};
