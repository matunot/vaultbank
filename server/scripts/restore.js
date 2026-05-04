/**
 * Restore script for VaultBank PostgreSQL database.
 *
 * Usage:
 *   node restore.js <backup-file.sql.gz>
 *
 * The script will:
 *   1. Verify the backup file exists.
 *   2. Decompress the file if it is gzipped.
 *   3. Pipe the SQL into `psql` using the DATABASE_URL environment variable.
 */

require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

if (process.argv.length < 3) {
    console.error('Usage: node restore.js <backup-file.sql.gz>');
    process.exit(1);
}

const backupFile = path.resolve(process.argv[2]);

if (!fs.existsSync(backupFile)) {
    console.error(`Backup file not found: ${backupFile}`);
    process.exit(1);
}

// Determine if the file is gzipped based on extension
let inputStream;
if (backupFile.endsWith('.gz')) {
    const gunzip = zlib.createGunzip();
    inputStream = fs.createReadStream(backupFile).pipe(gunzip);
} else {
    inputStream = fs.createReadStream(backupFile);
}

if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
}

// Use psql to execute the SQL statements
const restore = spawn('psql', [process.env.DATABASE_URL]);

inputStream.pipe(restore.stdin);

restore.stderr.on('data', (data) => {
    console.error(`psql error: ${data}`);
});

restore.on('close', (code) => {
    if (code !== 0) {
        console.error(`psql exited with code ${code}`);
        process.exit(1);
    }
    console.log('Restore completed successfully.');
});
