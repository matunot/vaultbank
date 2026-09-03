const fs = require('fs');
const d = fs.readFileSync('c:/Users/cr7/Desktop/vaultbank/client/dist/index.html', 'utf8');
console.log('Has API URL:', d.includes('vaultbank-md20') ? 'YES' : 'NO');
console.log('Has root div:', d.includes('id="root"') ? 'YES' : 'NO');
console.log('Title:', d.match(/<title>([^<]+)<\/title>/)?.[1] || 'NONE');
console.log('Length:', d.length);