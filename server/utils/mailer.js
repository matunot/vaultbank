const nodemailer = require('nodemailer');

/**
 * Send an admin alert email.
 * Uses SMTP configuration from environment variables.
 *
 * @param {string} subject - Email subject.
 * @param {string} text - Plain text body of the email.
 * @returns {Promise<void>}
 */
async function sendAdminAlert(subject, text) {
    // Create a transporter using the SMTP settings from .env
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: parseInt(process.env.SMTP_PORT, 10) === 465, // true for 465, false for other ports
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    const mailOptions = {
        from: process.env.SMTP_FROM || 'VaultBank <no-reply@vaultbank.com>',
        to: process.env.ADMIN_EMAIL || 'admin@vaultbank.com',
        subject,
        text,
    };

    await transporter.sendMail(mailOptions);
}

module.exports = { sendAdminAlert };
