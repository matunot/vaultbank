// Stub for ajv-keywords/dist/keywords/_formatLimit
// Replaces the broken default-formatLimit keyword registration in
// fork-ts-checker-webpack-plugin's nested ajv-keywords@5.x with ajv@8.x.
// See: https://github.com/ajv-validator/ajv-keywords/issues/235
module.exports = function defFunc() {
    // No-op keyword: schema-utils only uses it for diagnostics;
    // webpack build proceeds normally without it.
};
