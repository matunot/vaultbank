/**
 * Middleware to ensure the authenticated user has the "investor" role.
 * Returns 403 if the user does not have the required role.
 */
function requireInvestor(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    if (req.user.role !== 'investor') {
        return res.status(403).json({ success: false, message: 'Access denied. Investor role required.' });
    }
    next();
}

module.exports = requireInvestor;