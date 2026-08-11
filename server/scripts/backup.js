/**
 * Backup script for VaultBank PostgreSQL database.
 *
 * This script performs the following steps:
 *   1. Loads environment variables (including DATABASE_URL).
 *   2. Ensures a `backups` directory exists at the project root.
 *   3. Executes `pg_dump` to export the database schema and data.
 *   4. Writes the dump to a timestamped SQL file.
 *   5. Compresses the SQL file using gzip and removes the uncompressed file.
 *   6. Logs success or failure to the console.
 */

require('dotenv').config();

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Resolve the backups directory (project root / backups)
const backupDir = path.resolve(__dirname, '..', '..', 'backups');

// Ensure the backups directory exists
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Generate a timestamped filename
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const sqlFile = path.join(backupDir, `backup-${timestamp}.sql`);
const compressedFile = `${sqlFile}.gz`;

// Ensure DATABASE_URL is defined
if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
}

// Spawn pg_dump with the connection string
const dump = spawn('pg_dump', [process.env.DATABASE_URL]);

// Pipe the dump output to a file
const writeStream = fs.createWriteStream(sqlFile);
dump.stdout.pipe(writeStream);

// Capture any errors from pg_dump
dump.stderr.on('data', (data) => {
    console.error(`pg_dump error: ${data}`);
});

dump.on('close', (code) => {
    if (code !== 0) {
        console.error(`pg_dump exited with code ${code}`);
        // Clean up partial file if it exists
        if (fs.existsSync(sqlFile)) {
            fs.unlinkSync(sqlFile);
        }
        process.exit(1);
    }

    // Compress the SQL file using gzip
    const gzip = zlib.createGzip();
    const source = fs.createReadStream(sqlFile);
    const destination = fs.createWriteStream(compressedFile);
    source.pipe(gzip).pipe(destination).on('finish', () => {
        // Remove the uncompressed SQL file after compression
        fs.unlinkSync(sqlFile);
        console.log(`Backup successful: ${compressedFile}`);
    });
});
