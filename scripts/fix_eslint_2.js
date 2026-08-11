const fs = require('fs');

// Fix 2: admin.js - rename destructured vars to suppress unused warnings
let a = fs.readFileSync('server/routes/admin.js', 'utf8');
a = a.replace('const { password, ...userWithoutPwd } = u;', 'const { password: _pwd, ...userWithoutPwd } = u;');
a = a.replace('const { password, ...userWithoutPwd } = user;', 'const { password: _pwd2, ...userWithoutPwd } = user;');
fs.writeFileSync('server/routes/admin.js', a);
console.log('fix 2: admin.js');

// Fix 3: payments.js - add metrics import
let p = fs.readFileSync('server/routes/payments.js', 'utf8');
if (!p.includes('const metrics')) {
    p = p.replace("const ledger = require('../payments/ledger');\n", "const ledger = require('../payments/ledger');\nconst metrics = require('../metrics/payments');\n");
}
fs.writeFileSync('server/routes/payments.js', p);
console.log('fix 3: payments.js');

// Fix 4: index.js - remove unnecessary try/catch
let i = fs.readFileSync('server/payments/index.js', 'utf8');
if (i.includes('try {')) {
    i = i.replace(
        '        try {\n            requireRealKey(safetyName);\n        } catch (err) {\n            // Re-throw with the same code so the route can map to 503\n            throw err;\n        }',
        '        requireRealKey(safetyName);'
    );
}
fs.writeFileSync('server/payments/index.js', i);
console.log('fix 4: index.js');

console.log('All fixes applied');