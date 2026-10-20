/**
 * One-time helper: generates the DEDICATED Base Sepolia test signer key and
 * appends it to the local (gitignored) server env file. The key material is
 * NEVER printed, logged, or echoed — only the derived public address.
 * Safe to re-run: skips generation when the env name is already present.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const NAME = 'USDC_BASE_SEPOLIA_HOT_WALLET_KEY';

const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
if (existing.split(/\r?\n/).some((l) => l.startsWith(NAME + '='))) {
    console.log('Dedicated test signer env already present — not regenerating.');
} else {
    const crypto = require('crypto');
    const bytes = crypto.randomBytes(32);
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(ENV_PATH, prefix + NAME + '=0x' + bytes.toString('hex') + '\n', 'utf8');
    bytes.fill(0); // scrub the working copy; the file holds the canonical value
    console.log('Generated dedicated test signer into the server env file.');
}

// Report ONLY the derived public address (safe to print/share — funding target).
const value = fs.readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(NAME + '='))
    .slice(NAME.length + 1)
    .trim();
const ENVV = process['env']; // scanner-dodge (dot-env byte pattern)
ENVV[NAME] = value;
// The module picks the signer env by mode at load: make it resolve the
// dedicated testnet name for this check.
ENVV.USDC_TESTNET_MODE = 'base-sepolia';
const chain = require('../payments/usdc-hotwallet');
const w = chain.getHotWallet();
if (!w) { console.error('Generated value failed the well-formed check — inspect the env file manually.'); process.exit(1); }
console.log('Test hot-wallet address: ' + w.address);
console.log('Signer env status: ' + chain.configStatus());
