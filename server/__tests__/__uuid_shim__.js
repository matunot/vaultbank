// Tiny CJS shim for uuid used by Jest tests. Returns a deterministic// but unique-enough v4-style string. Production code uses the real
// uuid@14 ESM build which is fine for Node runtime.
let counter = 0;
function v4() {
    counter += 1;
    const a = Date.now().toString(16).padStart(12, '0');
    const b = counter.toString(16).padStart(4, '0');
    // eslint-disable-next-line no-unused-vars
    const d = (8 + Math.floor(Math.random() * 4)).toString(16) + Math.floor(Math.random() * 0x1000).toString(16).padStart(3, '0');
    const e = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0') + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return [a.slice(0, 8), a.slice(8, 12), '4' + b.slice(0, 3), d.slice(0, 4), e].join('-');
}
module.exports = { v4 };