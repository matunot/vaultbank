'use strict';

function privateApiHeaders(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
}

module.exports = { privateApiHeaders };
