/**
 * Utility script to fetch the latest audit logs from the PostgreSQL database.
 * This script is intended for developers to quickly verify that audit entries
 * are being persisted correctly after login and transfer actions.
 */

// Load environment variables from the .env file so that the DB connection
// string is available to the server configuration.
// Load environment variables from the project's root .env file. The script is
// executed from the project root, so we can simply call config() without a
// custom path. This ensures DATABASE_URL and other variables are available.
// Load environment variables from the project's root .env file. Using an
// absolute path ensures the file is found regardless of the current working
// directory when the script is executed.
const path = require('path');
// Load environment variables from the project's root .env file. Using an
// absolute path ensures the file is found regardless of the current working
// directory when the script is executed.
// Load .env file from the project root.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// Debug: output the resolved .env path and the DATABASE_URL value.
const envPath = path.resolve(__dirname, '..', '.env');
console.log('Loading environment from:', envPath);
console.log('DATABASE_URL after loading .env:', process.env.DATABASE_URL);

// Verify that the DATABASE_URL is present before proceeding.
if (!process.env.DATABASE_URL) {
    console.error('Failed to load DATABASE_URL from .env. Loaded env:', process.env);
    process.exit(1);
}

// Import the query helper from the server's DB configuration.
const { query } = require('../server/config/db');

(async () => {
    try {
        // Retrieve the most recent 10 audit log entries.
        const { rows } = await query(
            `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;`
        );

        if (rows.length === 0) {
            console.log('No audit logs found in the database.');
        } else {
            console.log('Latest audit logs:');
            console.table(rows);
        }
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        process.exit(1);
    }
})();
