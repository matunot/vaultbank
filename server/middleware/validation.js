/**
 * Validation middleware using Joi schemas.
 * Usage: validation(schema) where schema is a Joi object.
 * It validates req.body and req.query (if present) against the schema.
 * If validation fails, responds with 400 and error details.
 */
const Joi = require('joi');

function validation(schema) {
    return (req, res, next) => {
        // Combine body and query parameters for validation
        const data = { ...req.body, ...req.query };
        const { error, value } = schema.validate(data, { abortEarly: false, allowUnknown: true });
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                details: error.details.map(d => d.message)
            });
        }
        // Attach validated data to request for downstream handlers (optional)
        req.validated = value;
        next();
    };
}

module.exports = validation;
