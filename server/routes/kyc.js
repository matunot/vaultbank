const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const { query } = require('../config/db');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'kyc');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Use userId + timestamp + original extension
        const ext = path.extname(file.originalname);
        const filename = `${req.user.id}-${Date.now()}${ext}`;
        cb(null, filename);
    }
});

const upload = multer({ storage });

const router = express.Router();

/**
 * POST /api/kyc
 * Upload a KYC document for the authenticated user.
 * Expects multipart/form-data with field "document".
 */
router.post(
    '/api/kyc',
    authenticateToken,
    upload.single('document'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Document file is required.' });
            }
            const fileUrl = `/uploads/kyc/${req.file.filename}`; // Assuming static serving from /uploads
            const result = await query(
                `INSERT INTO kyc_documents (user_id, file_url) VALUES ($1, $2) RETURNING id, status, uploaded_at`,
                [req.user.id, fileUrl]
            );
            const doc = result.rows[0];
            return res.status(201).json({ success: true, data: doc });
        } catch (error) {
            console.error('KYC upload error:', error);
            return res.status(500).json({ success: false, message: 'Failed to upload KYC document.' });
        }
    }
);

/**
 * GET /api/kyc
 * Retrieve KYC documents for the authenticated user.
 */
router.get('/api/kyc', authenticateToken, async (req, res) => {
    try {
        const result = await query(`SELECT id, file_url, status, uploaded_at, reviewed_at FROM kyc_documents WHERE user_id = $1 ORDER BY uploaded_at DESC`, [req.user.id]);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        console.error('KYC fetch error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch KYC documents.' });
    }
});

/**
 * Admin endpoint to approve a KYC document.
 */
router.put(
    '/api/kyc/:id/approve',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        const { id } = req.params;
        try {
            // Approve the document and persist the user's KYC state in the same
            // SQL statement. Native fiat customer rails read users.kyc_status;
            // updating only kyc_documents left approved users blocked forever.
            const result = await query(
                `WITH approved_doc AS (
                    UPDATE kyc_documents
                       SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1
                     WHERE id = $2
                 RETURNING id, user_id, status, reviewed_at
                ), updated_user AS (
                    UPDATE users
                       SET kyc_status = 'verified'
                     WHERE id = (SELECT user_id FROM approved_doc)
                 RETURNING id
                )
                SELECT d.id, d.status, d.reviewed_at,
                       (u.id IS NOT NULL) AS user_verified
                  FROM approved_doc d
                  LEFT JOIN updated_user u ON TRUE`,
                [req.user.id, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'KYC document not found.' });
            }
            if (result.rows[0].user_verified !== true) {
                throw new Error('KYC document was updated but its user verification state could not be persisted.');
            }
            const { user_verified, ...document } = result.rows[0];
            return res.status(200).json({ success: true, data: document, kycStatus: 'verified' });
        } catch (error) {
            console.error('KYC approve error:', error);
            return res.status(500).json({ success: false, message: 'Failed to approve KYC document.' });
        }
    }
);

/**
 * Admin endpoint to reject a KYC document.
 */
router.put(
    '/api/kyc/:id/reject',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        const { id } = req.params;
        try {
            const result = await query(
                `UPDATE kyc_documents SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1 WHERE id = $2 RETURNING id, status, reviewed_at`,
                [req.user.id, id]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ success: false, message: 'KYC document not found.' });
            }
            return res.status(200).json({ success: true, data: result.rows[0] });
        } catch (error) {
            console.error('KYC reject error:', error);
            return res.status(500).json({ success: false, message: 'Failed to reject KYC document.' });
        }
    }
);

module.exports = router;
