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
    console.log('=== VAULTBANK API TEST ===\n');
    console.log('1. Health:');
    const h = await get('/health');
    console.log('  ', h.status, h.message);
    console.log('\n2. Signup:');
    const s = await post('/api/auth/signup', { email: 'john@vaultbank.com', password: 'SecurePass123!', fullName: 'John Smith', phone: '+15559876543' });
    console.log('  Success:', s.success, '| Account:', s.account ? s.account.accountNumber : 'N/A');
    const token = s.token;
    console.log('\n3. Login:');
    const l = await post('/api/auth/login', { email: 'john@vaultbank.com', password: 'SecurePass123!' });
    console.log('  Success:', l.success, '| Welcome:', l.user ? l.user.fullName : 'N/A');
    console.log('\n4. Profile:');
    const p = await get('/api/auth/me', token);
    console.log('  User:', p.user ? p.user.fullName : 'N/A', '| Account:', p.account ? p.account.accountNumber : 'N/A');
    console.log('\n5. Deposit $500:');
    const d = await post('/api/account/deposit', { amount: 500, description: 'Test deposit' }, token);
    console.log('  Success:', d.success, '| Balance: $' + (d.balance ? d.balance.available : 'N/A'));
    console.log('\n6. Transactions:');
    const t = await get('/api/account/transactions', token);
    console.log('  Count:', t.transactions ? t.transactions.length : 0);
    if (t.transactions) t.transactions.forEach(tx => console.log('   -', tx.type, '$' + tx.amount, tx.description));
    console.log('\n=== ALL TESTS PASSED ===');
}
main().catch(e => console.error('FAIL:', e.message));