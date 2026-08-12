/**
 * VaultBank Keep-Alive Script
 * 
 * Pings the Render backend health endpoint periodically to prevent
 * the free tier from spinning down after 15 minutes of inactivity.
 * 
 * Usage:
 *   node scripts/keep-alive.js              # Run once
 *   node scripts/keep-alive.js --interval 5 # Run every 5 minutes (default: 10)
 *   node scripts/keep-alive.js --loop       # Run continuously in a loop
 * 
 * Note: This script must run on an external machine (not on Render itself,
 * since a spun-down server can't ping itself). Best used with:
 *   - GitHub Actions cron (see .github/workflows/keep-alive.yml)
 *   - A local machine with a scheduled task / cron job
 *   - UptimeRobot or similar external monitoring service
 */

const https = require('https');

const DEFAULT_INTERVAL_MINUTES = 10;
const HEALTH_URL = 'https://vaultbank-md20.onrender.com/health';
const ROOT_URL = 'https://vaultbank-md20.onrender.com/';

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    interval: DEFAULT_INTERVAL_MINUTES,
    loop: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interval' && args[i + 1]) {
      config.interval = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--loop') {
      config.loop = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
VaultBank Keep-Alive Script
============================
Pings the Render backend to prevent free-tier spin-down.

Usage:
  node scripts/keep-alive.js              # Run once
  node scripts/keep-alive.js --interval 5 # Run every 5 minutes
  node scripts/keep-alive.js --loop       # Run continuously

Options:
  --interval <minutes>  Ping interval in minutes (default: ${DEFAULT_INTERVAL_MINUTES})
  --loop                Run continuously until stopped
  --help, -h            Show this help
`);
      process.exit(0);
    }
  }

  return config;
}

function ping(url) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const req = https.get(url, { timeout: 60000 }, (res) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const status = res.statusCode;
        const isColdStart = parseFloat(elapsed) > 30;

        console.log(
          `[${new Date().toISOString()}] ${url} → HTTP ${status} (${elapsed}s)${isColdStart ? ' ⚠️ COLD START' : ''}`
        );

        if (status >= 200 && status < 300) {
          resolve({ status, elapsed, isColdStart });
        } else {
          reject(new Error(`HTTP ${status} for ${url}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after 60s for ${url}`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function runOnce() {
  // Health endpoint is the critical keep-alive (it must always succeed)
  try {
    await ping(HEALTH_URL);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ❌ Keep-alive failed: ${err.message}`);
    return false;
  }

  // Root endpoint is informational — a 404 there is not fatal (server may
  // still be running older code before redeploy)
  try {
    await ping(ROOT_URL);
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] ⚠️ Root endpoint check failed (non-fatal): ${err.message}`);
  }

  return true;
}

async function main() {
  const config = parseArgs();

  console.log('🏦 VaultBank Keep-Alive Script');
  console.log(`   Health URL: ${HEALTH_URL}`);
  console.log(`   Interval: ${config.interval} minute(s)`);
  console.log(`   Mode: ${config.loop ? 'Continuous loop' : 'Run once'}`);
  console.log('');

  if (!config.loop) {
    const success = await runOnce();
    process.exit(success ? 0 : 1);
  }

  // Continuous loop mode
  console.log('Starting continuous keep-alive loop. Press Ctrl+C to stop.\n');

  // Run immediately, then on interval
  await runOnce();
  setInterval(runOnce, config.interval * 60 * 1000);
}

main();