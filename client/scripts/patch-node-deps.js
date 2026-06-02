// Patches dependencies that crash with NODE_ENV=production but are still
// loaded transitively. Runs automatically as a `postinstall` script.
//
// Patches:
//   1) ajv-keywords/dist/keywords/index.js - add stub implementations of
//      formatMinimum, formatMaximum, _formatLimit (which the published
//      5.1.0 bundle is missing but schema-utils@3 bundled in
//      fork-ts-checker-webpack-plugin requests by name).
//   2) react-refresh/cjs/react-refresh-babel.production.min.js - replace
//      the `if("development"!==z&&!p.skipEnvCheck) throw` with a no-op so
//      the plugin doesn't crash in production builds.

const fs = require('fs');
const path = require('path');

function patchAjvKeywords() {
    const target = path.join(
        __dirname, '..', 'node_modules', 'ajv-keywords',
        'dist', 'keywords', 'index.js'
    );
    if (!fs.existsSync(target)) {
        console.log('[patch-ajv-keywords] ajv-keywords not installed, skipping.');
        return;
    }
    let src = fs.readFileSync(target, 'utf8');
    const STUBS = `
const formatMinimum_1 = __importDefault(function formatMinimumStub() { return function () {}; });
const formatMaximum_1 = __importDefault(function formatMaximumStub() { return function () {}; });
const _formatLimit_1 = __importDefault(function _formatLimitStub() { return function () {}; });
`.trim();
    let patched = src;
    if (!patched.includes('formatMinimum_1')) {
        patched = patched.replace(
            'const ajvKeywords = {',
            `${STUBS}\nconst ajvKeywords = {`
        );
    }
    if (!patched.includes('formatMinimum:')) {
        patched = patched.replace(
            'const ajvKeywords = {',
            'const ajvKeywords = {\n    formatMinimum: formatMinimum_1.default,\n    formatMaximum: formatMaximum_1.default,\n    _formatLimit: _formatLimit_1.default,'
        );
    }
    if (patched === src) {
        console.log('[patch-ajv-keywords] already patched, nothing to do.');
        return;
    }
    fs.writeFileSync(target, patched, 'utf8');
    console.log('[patch-ajv-keywords] patched ' + target);
}

function patchReactRefresh() {
    const target = path.join(
        __dirname, '..', 'node_modules', 'react-refresh',
        'cjs', 'react-refresh-babel.production.min.js'
    );
    if (!fs.existsSync(target)) {
        console.log('[patch-react-refresh] target not found, skipping.');
        return;
    }
    let src = fs.readFileSync(target, 'utf8');
    const original = 'if("development"!==z&&!p.skipEnvCheck)';
    const patched = 'if(false)';
    if (src.includes(patched)) {
        console.log('[patch-react-refresh] already patched, nothing to do.');
        return;
    }
    if (!src.includes(original)) {
        console.log('[patch-react-refresh] env check not found, skipping.');
        return;
    }
    src = src.replace(original, patched);
    fs.writeFileSync(target, src, 'utf8');
    console.log('[patch-react-refresh] patched ' + target);
}

patchAjvKeywords();
patchReactRefresh();
