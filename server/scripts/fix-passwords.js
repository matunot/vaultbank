const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const DATABASE_URL = 'postgresql://neondb_owner:npg_mLs4My1Qewlu@ep-aged-mud-aqlu69dv-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require';

async function fixPasswords() {
    const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    
    try {
        const h1 = bcrypt.hashSync('password', 12);
        const h2 = bcrypt.hashSync('admin123', 12);
        
        await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [h1, 'demo@vaultbank.com']);
        console.log('Updated demo user password');
        
        await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [h2, 'admin@vaultbank.com']);
        console.log('Updated admin user password');
        
        console.log('Password hashes fixed successfully!');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

fixPasswords();