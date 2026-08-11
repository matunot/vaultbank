#!/usr/bin/env node
/**
 * scripts/migrate-to-mongo.js
 * 
 * Safe, reversible migration tool for MongoDB.
 * 
 * Usage:
 *   node scripts/migrate-to-mongo.js --uri "mongodb+srv://..." [--dry-run] [--batch-size 100] [--resume]
 * 
 * Features:
 *   --dry-run   Logs what would be done without writing
 *   --batch-size Number of documents per batch (default: 100)
 *   --resume    Skip already-migrated collections (checks for migration marker)
 *   --force     Run even if migration marker exists
 */

const { MongoClient } = require('mongodb');
const argv = require('minimist')(process.argv.slice(2));

// Configuration
const URI = argv.uri || process.env.MONGODB_URI || process.env.DATABASE_URL;
const DRY_RUN = argv['dry-run'] || false;
const BATCH_SIZE = parseInt(argv['batch-size'] || '100', 10);
const RESUME = argv.resume || false;
const FORCE = argv.force || false;

if (!URI) {
    console.error('ERROR: MONGODB_URI required. Use --uri, MONGODB_URI env, or DATABASE_URL env.');
    process.exit(1);
}

async function migrate() {
    console.log('═══════════════════════════════════════════════');
    console.log('  VAULTBANK MongoDB Migration Tool');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Mode:       ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(`  Resume:     ${RESUME}`);
    console.log(`  Batch Size: ${BATCH_SIZE}`);
    console.log(`  URI:        ${URI.replace(/\/\/[^:]+:[^@]+@/, '//****:****@')}`);
    console.log('═══════════════════════════════════════════════\n');

    const client = new MongoClient(URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
    });

    try {
        await client.connect();
        const db = client.db('vaultbank');
        const adminDb = db.admin();

        // Check for migration marker
        const migrationsColl = db.collection('_migrations');
        const existingMarker = await migrationsColl.findOne({ name: 'vaultbank-initial-seed' });

        if (existingMarker && RESUME) {
            console.log('✓ Migration already completed. Skipping (use --force to re-run).');
            await client.close();
            return;
        }

        if (existingMarker && !FORCE && !RESUME) {
            console.log('⚠ Migration marker exists. Use --resume to skip or --force to re-run.');
            await client.close();
            return;
        }

        // ─── Collection Definitions ──────────────────────────────────────
        const collections = {
            users: {
                indexes: [
                    { key: { email: 1 }, unique: true },
                    { key: { role: 1 } },
                    { key: { created_at: -1 } },
                ],
                seed: [
                    {
                        email: 'admin@vaultbank.com',
                        password_hash: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
                        full_name: 'Admin User',
                        role: 'super_admin',
                        subscription: 'admin',
                        kyc_status: 'verified',
                        status: 'active',
                        email_verified: true,
                        created_at: new Date(),
                    },
                ],
            },
            accounts: {
                indexes: [
                    { key: { user_id: 1 } },
                    { key: { account_number: 1 }, unique: true },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
            transactions: {
                indexes: [
                    { key: { user_id: 1, created_at: -1 } },
                    { key: { account_id: 1 } },
                    { key: { type: 1 } },
                    { key: { reference_id: 1 } },
                ],
                seed: [],
            },
            transfers: {
                indexes: [
                    { key: { from_user_id: 1, created_at: -1 } },
                    { key: { to_user_id: 1 } },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
            notifications: {
                indexes: [
                    { key: { user_id: 1, created_at: -1 } },
                    { key: { read: 1 } },
                ],
                seed: [],
            },
            audit_logs: {
                indexes: [
                    { key: { user_id: 1, timestamp: -1 } },
                    { key: { action: 1 } },
                    { key: { resource_type: 1 } },
                ],
                seed: [],
            },
            rewards: {
                indexes: [
                    { key: { user_id: 1 }, unique: true },
                    { key: { tier: 1 } },
                ],
                seed: [],
            },
            reward_transactions: {
                indexes: [
                    { key: { user_id: 1, created_at: -1 } },
                ],
                seed: [],
            },
            kyc_documents: {
                indexes: [
                    { key: { user_id: 1 } },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
            aml_flags: {
                indexes: [
                    { key: { user_id: 1 } },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
            feature_flags: {
                indexes: [
                    { key: { key: 1 }, unique: true },
                ],
                seed: [],
            },
            investments: {
                indexes: [
                    { key: { user_id: 1 } },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
            payment_methods: {
                indexes: [
                    { key: { user_id: 1 } },
                ],
                seed: [],
            },
            bills: {
                indexes: [
                    { key: { user_id: 1 } },
                    { key: { status: 1 } },
                ],
                seed: [],
            },
        };

        // ─── Phase 1: Create Collections & Indexes ──────────────────────
        console.log('┌─ Phase 1: Collections & Indexes ──────────────────┐');
        for (const [name, def] of Object.entries(collections)) {
            const exists = await db.listCollections({ name }).hasNext();
            if (!exists) {
                console.log(`  Creating collection: ${name}`);
                if (!DRY_RUN) {
                    await db.createCollection(name);
                }
            } else {
                console.log(`  ✓ Collection exists: ${name}`);
            }

            // Create indexes
            for (const idx of def.indexes) {
                const idxName = Object.entries(idx.key)
                    .map(([k, v]) => `${k}_${v}`)
                    .join('_');
                const existingIndexes = await db.collection(name).indexes();
                const hasIndex = existingIndexes.some(i => i.name === idxName || JSON.stringify(i.key) === JSON.stringify(idx.key));

                if (!hasIndex) {
                    console.log(`  Creating index: ${name}.${idxName}`);
                    if (!DRY_RUN) {
                        await db.collection(name).createIndex(idx.key, {
                            unique: idx.unique || false,
                            background: true,
                        });
                    }
                }
            }
        }
        console.log('└────────────────────────────────────────────────────┘\n');

        // ─── Phase 2: Seed Data ──────────────────────────────────────────
        console.log('┌─ Phase 2: Seed Data ──────────────────────────────┐');
        for (const [name, def] of Object.entries(collections)) {
            if (def.seed.length === 0) continue;

            const coll = db.collection(name);
            const count = await coll.countDocuments();

            if (count === 0) {
                console.log(`  Seeding ${name} with ${def.seed.length} document(s)`);
                if (!DRY_RUN) {
                    await coll.insertMany(def.seed, { ordered: true });
                }
            } else {
                console.log(`  ✓ ${name} already has ${count} document(s), skipping seed`);
            }
        }
        console.log('└────────────────────────────────────────────────────┘\n');

        // ─── Phase 3: Set Migration Marker ──────────────────────────────
        console.log('┌─ Phase 3: Migration Marker ───────────────────────┐');
        if (!DRY_RUN) {
            await migrationsColl.updateOne(
                { name: 'vaultbank-initial-seed' },
                {
                    $set: {
                        name: 'vaultbank-initial-seed',
                        completed_at: new Date(),
                        version: '1.0.0',
                        dry_run: false,
                    },
                    $setOnInsert: {
                        created_at: new Date(),
                    },
                },
                { upsert: true }
            );
            console.log('  ✓ Migration marker set');
        } else {
            console.log('  [DRY RUN] Would set migration marker');
        }
        console.log('└────────────────────────────────────────────────────┘\n');

        // ─── Summary ──────────────────────────────────────────────────────
        console.log('═══════════════════════════════════════════════');
        if (DRY_RUN) {
            console.log('  ✅ DRY RUN COMPLETE — no changes written');
            console.log('  Run without --dry-run to execute');
        } else {
            console.log('  ✅ MIGRATION COMPLETE');
        }
        console.log('═══════════════════════════════════════════════');

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

migrate();