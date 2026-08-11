const http = require('http');
function post(path, data, token) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = http.request({ hostname: 'localhost', port: 5000, path, method: 'POST', headers }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}
function get(path, token) {
    return new Promise((resolve, reject) => {
        const headers = {}; if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = http.request({ hostname: 'localhost', port: 5000, path, method: 'GET', headers }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
        });
        req.on('error', reject); req.end();
    });
}
async function main() {
    console.log('=== VAULTBANK FULL FLOW TEST ===\n');
    const email = 'test-' + Date.now() + '@vaultbank.com';
    console.log('1. Signup new user:', email);
    const s = await post('/api/auth/signup', { email, password: 'MyPass123!', fullName: 'Test User', phone: '+15551234567' });
    console.log('   Success:', s.success, s.success ? '| Account: ' + (s.account ? s.account.accountNumber : 'N/A') : '| ' + s.message);
    if (!s.success) {
        console.log('\n❌ SIGNUP FAILED! Check server logs.');
        return;
    }
    const token = s.token;
    console.log('   Token received:', token ? 'YES (' + token.substring(0, 20) + '...)' : 'NO');
    console.log('\n2. Profile (/api/auth/me):');
    const p = await get('/api/auth/me', token);
    console.log('   Success:', p.success, '| User:', p.user ? p.user.fullName : 'N/A', '| Account:', p.account ? p.account.accountNumber : 'N/A');
    console.log('\n3. Balance:');
    const b = await get('/api/account/balance', token);
    console.log('   Available: $' + (b.balance ? b.balance.available : 'N/A'));
    console.log('\n4. Deposit $1000:');
    const d = await post('/api/account/deposit', { amount: 1000, description: 'Initial deposit' }, token);
    console.log('   Success:', d.success, '| Balance: $' + (d.balance ? d.balance.available : 'N/A'));
    console.log('\n5. Transactions:');
    const t = await get('/api/account/transactions', token);
    console.log('   Count:', t.transactions ? t.transactions.length : 0);
    if (t.transactions) t.transactions.forEach(tx => console.log('   -', tx.type, '$' + tx.amount, tx.description));
    console.log('\n=== FULL FLOW TEST PASSED ===');
    console.log('Email:', email, '| Token:', token ? token.substring(0, 30) + '...' : 'MISSING');
}
main().catch(e => console.error('FAIL:', e.message));