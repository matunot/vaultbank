#!/usr/bin/env node
/**
 * Performance regression budget for the built client.
 * Run after `npm run build`.
 *
 * Budgets are for compressed transfer size (what a user actually downloads):
 *   - initial JS: 105 KiB hard / 100 KiB target
 *   - initial JS + CSS: 125 KiB hard / 120 KiB target
 *   - any single asset: 250 KiB
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const entryMatch = html.match(/<script[^>]+src="([^"]+\.js)"/);
const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/);
if (!entryMatch) {
  console.error('budget: could not find the entry script in dist/index.html');
  process.exit(1);
}

const KiB = 1024;
const toPath = (url) => join(dist, url.replace(/^\//, ''));
const gzipBytes = (file) => gzipSync(readFileSync(file)).length;
const kb = (bytes) => `${(bytes / KiB).toFixed(2)} KiB`;

const entryBytes = gzipBytes(toPath(entryMatch[1]));
const cssBytes = cssMatch ? gzipBytes(toPath(cssMatch[1])) : 0;
const combined = entryBytes + cssBytes;

const assets = readdirSync(join(dist, 'assets')).map((name) => {
  const file = join(dist, 'assets', name);
  const raw = statSync(file).size;
  return { name, raw, gzip: name.endsWith('.js') || name.endsWith('.css') ? gzipBytes(file) : raw };
});
const largest = assets.sort((a, b) => b.gzip - a.gzip)[0];

console.log('VaultBank client budgets');
console.log(`  entry JS   ${kb(entryBytes)} gzip (${entryMatch[1]})`);
console.log(`  entry CSS  ${kb(cssBytes)} gzip`);
console.log(`  combined   ${kb(combined)} gzip`);
console.log(`  largest    ${largest ? `${largest.name} ${kb(largest.gzip)} gzip` : 'n/a'}`);

const failures = [];
if (entryBytes > 105 * KiB) failures.push(`initial JS ${kb(entryBytes)} exceeds hard budget 105 KiB`);
if (combined > 125 * KiB) failures.push(`initial JS+CSS ${kb(combined)} exceeds hard budget 125 KiB`);
if (largest && largest.gzip > 250 * KiB) failures.push(`largest asset ${largest.name} ${kb(largest.gzip)} exceeds 250 KiB`);

if (entryBytes > 100 * KiB) console.warn(`  warning: initial JS is above the 100 KiB target (${kb(entryBytes)}).`);
if (combined > 120 * KiB) console.warn(`  warning: initial JS+CSS is above the 120 KiB target (${kb(combined)}).`);

if (failures.length) {
  console.error('\nBudget failures:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nBudget: PASS');
