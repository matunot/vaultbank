const https = require('https');
https.get('https://vaultbank.vercel.app/', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Title:', d.match(/<title>([^<]+)<\/title>/)?.[1] || 'NONE');
    console.log('Has React root:', d.includes('id="root"') ? 'YES' : 'NO');
    console.log('Has API URL:', d.includes('vaultbank-md20') ? 'YES' : 'NO');
    console.log('Has Bootstrap:', d.includes('bootstrap') ? 'YES (old)' : 'NO (good)');
  });
}).on('error', e => console.log('ERR:', e.message));