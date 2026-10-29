'use strict';

/**
 * Native KYC document intake and review.
 *
 * Documents are stored in PostgreSQL, not on the application filesystem:
 * Render replaces the container disk on deploy, so a disk-only upload would
 * silently lose a customer's identity document between submission and review.
 *
 * This router never sets users.kyc_status to 'verified' on upload. Only an
 * authenticated admin approval does that, in the same SQL statement as the
 * document status change.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { query, getClient, isDemo } = require('../config/db');

const MIGRATION_FILE = '014_kyc_document_files.sql';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = new Set([
    'passport',
    'drivers_license',
    'national_id',
    'proof_of_address',
    'bank_statement',
    'selfie',
    'other',
]);
const DOCUMENT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_MIME = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['application/pdf', '.pdf'],
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

/**
 * The upload's MIME type and filename are attacker-controlled strings. Verify
 * the actual bytes before storing them, so a renamed HTML/EXE file cannot be
 * filed as an identity document and later handed back to a reviewer.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');

function documentBytesMatchDeclaredType(buffer, mime) {
    if (!Buffer.isBuffer(buffer)) return false;
    if (mime === 'image/png') {
        return buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    }
    if (mime === 'image/jpeg') {
        return buffer.length > JPEG_SIGNATURE.length && buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
    }
    if (mime === 'application/pdf') {
        return buffer.length > PDF_SIGNATURE.length && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
    }
    return false;
}

let schemaReady = false;
let schemaPromise = null;

async function ensureKycFileSchema() {
    if (isDemo) {
        const error = new Error('KYC document storage requires persistent PostgreSQL.');
        error.code = 'KYC_REQUIRES_POSTGRES';
        throw error;
    }
    if (schemaReady) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const client = await getClient();
        try {
            await client.query('BEGIN');
            // Serialize the runtime migration across application instances.
            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext('vaultbank-runtime-migration'), hashtext($1))",
                [MIGRATION_FILE]
            );
            await client.query(`
                CREATE TABLE IF NOT EXISTS _migrations (
                    id SERIAL PRIMARY KEY,
                    filename TEXT NOT NULL UNIQUE,
                    executed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            `);
            const { rows } = await client.query(
                'SELECT filename FROM _migrations WHERE filename = $1 LIMIT 1',
                [MIGRATION_FILE]
            );
            if (rows.length === 0) {
                const migrationPath = path.join(__dirname, '..', 'migrations', MIGRATION_FILE);
                const sql = fs.readFileSync(migrationPath, 'utf8');
                await client.query(sql);
                await client.query(
                    'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
                    [MIGRATION_FILE]
                );
            }
            const ready = await client.query(
                "SELECT to_regclass('public.kyc_documents') IS NOT NULL AS documents, " +
                "to_regclass('public.kyc_document_files') IS NOT NULL AS files"
            );
            const status = ready.rows[0];
            if (!status || !status.documents || !status.files) {
                const error = new Error('KYC document schema did not pass its post-migration readiness check.');
                error.code = 'KYC_SCHEMA_NOT_READY';
                throw error;
            }
            await client.query('COMMIT');
            schemaReady = true;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
            throw error;
        } finally {
            client.release();
        }
    })();

    try {
        await schemaPromise;
    } catch (error) {
        schemaPromise = null;
        throw error;
    }
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype || '').toLowerCase();
        const ext = path.extname(String(file.originalname || '')).toLowerCase();
        if (!ALLOWED_MIME.has(mime) || !ALLOWED_EXTENSIONS.has(ext)) {
            const error = new Error('Only JPEG, PNG, or PDF identity documents are accepted.');
            error.code = 'KYC_UNSUPPORTED_FILE_TYPE';
            return cb(error);
        }
        cb(null, true);
    },
});

function receiveDocument(req, res, next) {
    upload.single('document')(req, res, (error) => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                code: 'KYC_FILE_TOO_LARGE',
                message: 'The identity document must be 5 MB or smaller.',
            });
        }
        if (error.code === 'KYC_UNSUPPORTED_FILE_TYPE') {
            return res.status(400).json({
                success: false,
                code: 'KYC_UNSUPPORTED_FILE_TYPE',
                message: 'Only JPEG, PNG, or PDF identity documents are accepted.',
            });
        }
        return res.status(400).json({
            success: false,
            code: 'KYC_UPLOAD_INVALID',
            message: 'The identity document upload could not be read. Submit one JPEG, PNG, or PDF file.',
        });
    });
}

function clientIp(req) {
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
    return req.ip || null;
}

function kycUnavailable(res) {
    return res.status(503).json({
        success: false,
        code: 'KYC_REQUIRES_POSTGRES',
        message: 'Identity verification requires the persistent VaultBank database and is unavailable in demo mode.',
    });
}

async function writeAudit(req, action, resourceId, details) {
    try {
        await query(
            `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
             VALUES ($1, $2, 'kyc_document', $3, $4, $5, $6)`,
            [
                req.user.id,
                action,
                String(resourceId),
                JSON.stringify(details || {}),
                clientIp(req),
                String((req.headers && req.headers['user-agent']) || '').slice(0, 500) || null,
            ]
        );
    } catch (error) {
        // The document state is already committed; an audit-log outage must not
        // pretend the upload or review itself failed.
        console.error('KYC audit log error:', error && error.code ? error.code : 'audit-error');
    }
}

function serializeDocument(row) {
    return {
        id: row.id,
        documentType: row.document_type,
        documentName: row.document_name,
        status: row.status,
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        reviewNotes: row.review_notes || null,
    };
}

function nextStepFor({ emailVerified, kycStatus, pendingDocument }) {
    if (!emailVerified) {
        return 'Verify your email address before submitting an identity document.';
    }
    if (kycStatus === 'verified') {
        return 'Identity verification is complete. No further document is needed.';
    }
    if (pendingDocument) {
        return 'Your document is waiting for human review. Do not upload another copy unless it is rejected.';
    }
    if (kycStatus === 'rejected') {
        return 'Your previous document was rejected. Review the note and submit a corrected document.';
    }
    return 'Submit one government-issued photo ID or a recent proof-of-address document.';
}

const router = express.Router();

/**
 * POST /api/kyc
 * Multipart upload: field "document", plus "documentType".
 * Stores the bytes in PostgreSQL so review survives a redeploy.
 */
router.post('/api/kyc', authenticateToken, receiveDocument, async (req, res) => {
    try {
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
            return res.status(400).json({
                success: false,
                code: 'KYC_DOCUMENT_REQUIRED',
                message: 'Attach one identity document to upload.',
            });
        }
        if (isDemo) return kycUnavailable(res);
        if (req.user.email_verified !== true) {
            return res.status(403).json({
                success: false,
                code: 'EMAIL_VERIFICATION_REQUIRED',
                message: 'Verify your email address before submitting identity documents.',
            });
        }
        if (req.user.kyc_status === 'verified') {
            return res.status(409).json({
                success: false,
                code: 'KYC_ALREADY_VERIFIED',
                message: 'Your identity is already verified. No further document is required.',
            });
        }

        const documentType = String((req.body && req.body.documentType) || '').trim();
        if (!DOCUMENT_TYPES.has(documentType)) {
            return res.status(400).json({
                success: false,
                code: 'KYC_DOCUMENT_TYPE_INVALID',
                message: 'Choose a supported document type before uploading.',
            });
        }

        // Validate the file's real content before touching the database.
        const mime = String(req.file.mimetype || '').toLowerCase();
        if (!ALLOWED_MIME.has(mime)) {
            return res.status(400).json({
                success: false,
                code: 'KYC_UNSUPPORTED_FILE_TYPE',
                message: 'Only JPEG, PNG, or PDF identity documents are accepted.',
            });
        }
        if (!documentBytesMatchDeclaredType(req.file.buffer, mime)) {
            return res.status(400).json({
                success: false,
                code: 'KYC_FILE_CONTENT_MISMATCH',
                message: 'The file contents do not match a JPEG, PNG, or PDF document. Nothing was stored.',
            });
        }

        // Cheap pre-check before the schema/migration path. The transaction
        // below repeats it under an advisory lock so concurrent uploads cannot
        // both pass this check.
        const existing = await query(
            `SELECT id FROM kyc_documents
              WHERE user_id = $1 AND status IN ('pending', 'approved')
              LIMIT 1`,
            [req.user.id]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({
                success: false,
                code: 'KYC_REVIEW_IN_PROGRESS',
                message: 'A KYC document is already pending or approved. No second document was stored.',
            });
        }

        await ensureKycFileSchema();

        const documentName = path.basename(String(req.file.originalname || 'identity-document')).slice(0, 200);
        const client = await getClient();
        let document;
        try {
            await client.query('BEGIN');
            // Serialize submissions per customer. Two concurrent uploads must
            // not create two pending documents for one person.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kyc-submission:${req.user.id}`]);
            const duplicate = await client.query(
                `SELECT id, status FROM kyc_documents
                  WHERE user_id = $1 AND status IN ('pending', 'approved')
                  ORDER BY submitted_at DESC NULLS LAST LIMIT 1`,
                [req.user.id]
            );
            if (duplicate.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    code: 'KYC_REVIEW_IN_PROGRESS',
                    message: 'A KYC document is already pending or approved. No second document was stored.',
                });
            }

            const inserted = await client.query(
                `INSERT INTO kyc_documents (user_id, document_type, document_url, document_name, status)
                 VALUES ($1, $2, $3, $4, 'pending')
                 RETURNING id, document_type, document_name, status, submitted_at, reviewed_at, review_notes`,
                [req.user.id, documentType, 'pending://kyc-document', documentName]
            );
            document = inserted.rows[0];
            const documentUrl = `/api/kyc/${document.id}/file`;
            await client.query(
                'UPDATE kyc_documents SET document_url = $2 WHERE id = $1',
                [document.id, documentUrl]
            );
            await client.query(
                `INSERT INTO kyc_document_files (document_id, mime_type, byte_size, content)
                 VALUES ($1, $2, $3, $4)`,
                [document.id, mime, req.file.buffer.length, req.file.buffer]
            );
            await client.query(
                "UPDATE users SET kyc_status = 'submitted', kyc_submitted_at = COALESCE(kyc_submitted_at, NOW()) WHERE id = $1 AND kyc_status <> 'verified'",
                [req.user.id]
            );
            await client.query('COMMIT');
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
            throw error;
        } finally {
            client.release();
        }

        // The authenticated user object is a snapshot from the token middleware.
        // Record the state this request actually committed for the UI.
        req.user.kyc_status = 'submitted';
        await writeAudit(req, 'kyc.document_uploaded', document.id, {
            documentType,
            mimeType: mime,
            byteSize: req.file.buffer.length,
        });

        return res.status(201).json({
            success: true,
            data: serializeDocument(document),
            kycStatus: 'submitted',
            message: 'Identity document received. A VaultBank reviewer must approve it before it counts as verification.',
        });
    } catch (error) {
        if (error && error.code === 'KYC_REQUIRES_POSTGRES') {
            return res.status(503).json({
                success: false,
                code: 'KYC_REQUIRES_POSTGRES',
                message: 'Identity verification requires the persistent VaultBank database and is unavailable in demo mode.',
            });
        }
        if (error && error.code === 'KYC_SCHEMA_NOT_READY') {
            return res.status(503).json({
                success: false,
                code: 'KYC_SCHEMA_NOT_READY',
                message: 'Identity document storage is not ready. No document was stored.',
            });
        }
        console.error('KYC upload error:', error && error.code ? error.code : 'upload-error');
        return res.status(500).json({
            success: false,
            code: 'KYC_UPLOAD_FAILED',
            message: 'The identity document could not be stored. Nothing was submitted for review.',
        });
    }
});

/**
 * GET /api/kyc
 * Current persisted verification state plus this customer's document history.
 */
router.get('/api/kyc', authenticateToken, async (req, res) => {
    if (isDemo) return kycUnavailable(res);
    try {
        const result = await query(
            `SELECT id, document_type, document_name, status, submitted_at, reviewed_at, review_notes
               FROM kyc_documents
              WHERE user_id = $1
              ORDER BY submitted_at DESC NULLS LAST
              LIMIT 50`,
            [req.user.id]
        );
        const documents = result.rows.map(serializeDocument);
        const pendingDocument = documents.find((doc) => doc.status === 'pending') || null;
        const emailVerified = req.user.email_verified === true;
        const kycStatus = req.user.kyc_status || 'pending';
        return res.status(200).json({
            success: true,
            data: documents,
            emailVerified,
            kycStatus,
            pendingDocument,
            canSubmit: emailVerified && kycStatus !== 'verified' && !pendingDocument,
            nextStep: nextStepFor({ emailVerified, kycStatus, pendingDocument }),
        });
    } catch (error) {
        console.error('KYC fetch error:', error && error.code ? error.code : 'fetch-error');
        return res.status(500).json({
            success: false,
            message: 'Could not load identity verification status.',
        });
    }
});

/**
 * GET /api/kyc/:id/file
 * Owner or admin only. Streams the stored bytes from PostgreSQL.
 */
router.get('/api/kyc/:id/file', authenticateToken, async (req, res) => {
    if (isDemo) return kycUnavailable(res);
    try {
        const { id } = req.params;
        if (!UUID_RE.test(String(id))) {
            return res.status(404).json({ success: false, message: 'KYC document not found.' });
        }
        const result = await query(
            `SELECT d.id, d.user_id, d.document_name, f.mime_type, f.content
               FROM kyc_documents d
               LEFT JOIN kyc_document_files f ON f.document_id = d.id
              WHERE d.id = $1`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'KYC document not found.' });
        }
        const row = result.rows[0];
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        if (row.user_id !== req.user.id && !isAdmin) {
            // Do not confirm that another customer's document exists.
            return res.status(404).json({ success: false, message: 'KYC document not found.' });
        }
        if (!row.content) {
            return res.status(410).json({
                success: false,
                code: 'KYC_FILE_UNAVAILABLE',
                message: 'The stored document bytes are unavailable. Ask the customer to resubmit.',
            });
        }
        const safeName = String(row.document_name || 'kyc-document')
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .slice(0, 120) || 'kyc-document';
        res.set({
            'Content-Type': row.mime_type || 'application/octet-stream',
            'Content-Length': String(row.content.length),
            'Content-Disposition': `attachment; filename="${safeName}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        return res.status(200).send(row.content);
    } catch (error) {
        console.error('KYC file fetch error:', error && error.code ? error.code : 'file-error');
        return res.status(500).json({ success: false, message: 'Could not load the KYC document.' });
    }
});

/**
 * GET /api/admin/kyc?status=pending
 * Human review queue with customer identity state; never exposes file bytes.
 */
router.get('/api/admin/kyc', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    if (isDemo) return kycUnavailable(res);
    try {
        const requested = String((req.query && req.query.status) || 'pending').trim();
        if (requested !== 'all' && !DOCUMENT_STATUSES.has(requested)) {
            return res.status(400).json({
                success: false,
                code: 'KYC_STATUS_INVALID',
                message: 'Status must be pending, approved, rejected, or all.',
            });
        }
        const params = [];
        let where = '';
        if (requested !== 'all') {
            params.push(requested);
            where = 'WHERE d.status = $1';
        }
        const result = await query(
            `SELECT d.id, d.user_id, d.document_type, d.document_name, d.status,
                    d.submitted_at, d.reviewed_at, d.review_notes,
                    u.email, u.full_name, u.kyc_status, u.email_verified,
                    EXISTS (SELECT 1 FROM kyc_document_files f WHERE f.document_id = d.id) AS has_file
               FROM kyc_documents d
               JOIN users u ON u.id = d.user_id
               ${where}
              ORDER BY d.submitted_at ASC NULLS LAST
              LIMIT 100`,
            params
        );
        const documents = result.rows.map((row) => ({
            ...serializeDocument(row),
            hasFile: row.has_file === true,
            customer: {
                id: row.user_id,
                email: row.email,
                fullName: row.full_name,
                kycStatus: row.kyc_status,
                emailVerified: row.email_verified === true,
            },
        }));
        return res.status(200).json({ success: true, data: documents });
    } catch (error) {
        console.error('KYC admin queue error:', error && error.code ? error.code : 'queue-error');
        return res.status(500).json({ success: false, message: 'Could not load the KYC review queue.' });
    }
});

/**
 * PUT /api/kyc/:id/approve
 * Approves the document and persists users.kyc_status = 'verified' atomically.
 */
router.put('/api/kyc/:id/approve', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    if (isDemo) return kycUnavailable(res);
    const { id } = req.params;
    if (!UUID_RE.test(String(id))) {
        return res.status(404).json({
            success: false,
            code: 'KYC_PENDING_DOCUMENT_NOT_FOUND',
            message: 'No pending KYC document with that id was found.',
        });
    }
    const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
    try {
        const result = await query(
            `WITH approved_doc AS (
                UPDATE kyc_documents
                   SET status = 'approved',
                       reviewed_at = NOW(),
                       reviewed_by = $1,
                       review_notes = CASE WHEN $3 = '' THEN review_notes ELSE $3 END
                 WHERE id = $2 AND status = 'pending'
             RETURNING id, user_id, status, reviewed_at
            ), updated_user AS (
                UPDATE users
                   SET kyc_status = 'verified',
                       kyc_verified_at = NOW()
                 WHERE id = (SELECT user_id FROM approved_doc)
             RETURNING id
            )
            SELECT d.id, d.user_id, d.status, d.reviewed_at,
                   (u.id IS NOT NULL) AS user_verified
              FROM approved_doc d
              LEFT JOIN updated_user u ON TRUE`,
            [req.user.id, id, note]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'KYC_PENDING_DOCUMENT_NOT_FOUND',
                message: 'No pending KYC document with that id was found.',
            });
        }
        if (result.rows[0].user_verified !== true) {
            throw new Error('KYC document was updated but its user verification state could not be persisted.');
        }
        const { user_verified, user_id, ...document } = result.rows[0];
        await writeAudit(req, 'kyc.document_approved', document.id, {
            customerUserId: user_id,
            note: note || null,
        });
        return res.status(200).json({
            success: true,
            data: {
                id: document.id,
                status: document.status,
                reviewedAt: document.reviewed_at,
            },
            kycStatus: 'verified',
            message: 'Identity document approved. The customer is now KYC verified.',
        });
    } catch (error) {
        console.error('KYC approve error:', error && error.code ? error.code : 'approve-error');
        return res.status(500).json({ success: false, message: 'Failed to approve the KYC document.' });
    }
});

/**
 * PUT /api/kyc/:id/reject
 * Rejects the document and records a customer-visible reason. A verified user
 * is never silently downgraded by a stray rejection.
 */
router.put('/api/kyc/:id/reject', authenticateToken, requireAdmin, adminLimiter, async (req, res) => {
    if (isDemo) return kycUnavailable(res);
    const { id } = req.params;
    if (!UUID_RE.test(String(id))) {
        return res.status(404).json({
            success: false,
            code: 'KYC_PENDING_DOCUMENT_NOT_FOUND',
            message: 'No pending KYC document with that id was found.',
        });
    }
    const note = String((req.body && req.body.note) || '').trim();
    if (note.length < 5 || note.length > 500) {
        return res.status(400).json({
            success: false,
            code: 'KYC_REVIEW_NOTE_REQUIRED',
            message: 'Give the customer a review note of 5 to 500 characters explaining the rejection.',
        });
    }
    try {
        const result = await query(
            `WITH rejected_doc AS (
                UPDATE kyc_documents
                   SET status = 'rejected',
                       reviewed_at = NOW(),
                       reviewed_by = $1,
                       review_notes = $3
                 WHERE id = $2 AND status = 'pending'
             RETURNING id, user_id, status, reviewed_at, review_notes
            ), updated_user AS (
                UPDATE users
                   SET kyc_status = 'rejected'
                 WHERE id = (SELECT user_id FROM rejected_doc)
                   AND kyc_status <> 'verified'
             RETURNING id
            )
            SELECT d.id, d.user_id, d.status, d.reviewed_at, d.review_notes,
                   (u.id IS NOT NULL) AS user_marked_rejected
              FROM rejected_doc d
              LEFT JOIN updated_user u ON TRUE`,
            [req.user.id, id, note]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                code: 'KYC_PENDING_DOCUMENT_NOT_FOUND',
                message: 'No pending KYC document with that id was found.',
            });
        }
        const row = result.rows[0];
        await writeAudit(req, 'kyc.document_rejected', row.id, {
            customerUserId: row.user_id,
            note,
        });
        return res.status(200).json({
            success: true,
            data: {
                id: row.id,
                status: row.status,
                reviewedAt: row.reviewed_at,
                reviewNotes: row.review_notes,
            },
            kycStatus: row.user_marked_rejected === true ? 'rejected' : 'verified',
            message: 'Identity document rejected. The reason is visible to the customer.',
        });
    } catch (error) {
        console.error('KYC reject error:', error && error.code ? error.code : 'reject-error');
        return res.status(500).json({ success: false, message: 'Failed to reject the KYC document.' });
    }
});

module.exports = router;
