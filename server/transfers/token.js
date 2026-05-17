/**
 * Utility for generating privacy‑focused transfer tokens.
 * The token consists of a UUIDv4 and an HMAC‑SHA256 signature using a secret.
 * The format is `${uuid}.${hmac}` which can be safely shared with the receiver.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Generate a transfer token for a given sender and amount.
 * The token does not embed the amount or IDs – those are stored server‑side.
 * @param {string} senderId - UUID of the sender (from_user).
 * @param {number|string} amount - Transfer amount (used only for logging/audit).
 * @returns {string} token string in the form `${uuid}.${hmac}`
 */
function generateTransferToken(_senderId, _amount) {
    // The secret used for HMAC is stored in environment variable TRANSFER_TOKEN_SECRET.
    const secret = process.env.TRANSFER_TOKEN_SECRET;
    if (!secret) {
        throw new Error('TRANSFER_TOKEN_SECRET environment variable is not set');
    }
    // Create a random UUID for the token payload.
    const uuid = uuidv4();
    // Compute HMAC‑SHA256 over the UUID using the secret.
    const hmac = crypto.createHmac('sha256', secret).update(uuid).digest('hex');
    // Concatenate UUID and HMAC with a dot separator.
    const token = `${uuid}.${hmac}`;
    // Optionally, you could log the generation for audit purposes.
    // Note: Do NOT expose the secret or HMAC to the client.
    return token;
}

/**
 * Verify a transfer token.
 * @param {string} token - Token string in the form `${uuid}.${hmac}`.
 * @returns {boolean} true if token is valid, false otherwise.
 */
function verifyTransferToken(token) {
    if (!token) return false;
    const secret = process.env.TRANSFER_TOKEN_SECRET;
    if (!secret) {
        // If secret is not set, we cannot verify tokens.
        return false;
    }
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [uuid, providedHmac] = parts;
    // Recompute HMAC using the secret.
    const expectedHmac = crypto.createHmac('sha256', secret).update(uuid).digest('hex');
    // Use timingSafeEqual to prevent timing attacks.
    const bufferA = Buffer.from(providedHmac, 'hex');
    const bufferB = Buffer.from(expectedHmac, 'hex');
    if (bufferA.length !== bufferB.length) return false;
    return crypto.timingSafeEqual(bufferA, bufferB);
}

module.exports = {
    generateTransferToken,
    verifyTransferToken,
};
