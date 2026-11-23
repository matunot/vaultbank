'use strict';

const crypto = require('crypto');
const saltEdge = require('../services/saltEdgePartnerPIS');
const saltEdgeRouter = require('../routes/salt-edge-pis');

describe('Salt Edge Partner PIS security helpers', () => {
    test('loads the Express router without starting provider calls', () => {
        expect(saltEdgeRouter).toBeDefined();
        expect(typeof saltEdgeRouter.use).toBe('function');
    });

    test('signs the exact outgoing request canonical string', () => {
        const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
        const publicKey = pair.publicKey;
        const expiresAt = 1893456000;
        const method = 'POST';
        const url = 'https://www.saltedge.com/api/partners/v1/payments/sessions';
        const body = '{"data":{"amount":"12.00"}}';
        const signature = saltEdge.signRequest(privateKey, expiresAt, method, url, body);
        const canonical = [String(expiresAt), method, url, body].join('|');
        expect(crypto.verify('RSA-SHA256', Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
    });

    test('rejects missing or unknown callback signature versions', () => {
        expect(saltEdge.verifyCallback(Buffer.from('{"data":{}}'), 'not-a-signature', '99.0', 'https://example.com/callback')).toBe(false);
        expect(saltEdge.verifyCallback(null, 'signature', '4.0', 'https://example.com/callback')).toBe(false);
    });

    test('normalizes valid decimal amounts and rejects invalid precision', () => {
        expect(saltEdge.amountString('25')).toBe('25.00');
        expect(saltEdge.amountString('25.7')).toBe('25.70');
        expect(saltEdge.amountString('25.777')).toBeNull();
        expect(saltEdge.amountString('-1.00')).toBeNull();
    });

    test('fails closed until the Live flag and signing configuration exist', () => {
        const names = [
            'VB_SALT_EDGE_PIS_ENABLED',
            'VB_SALT_EDGE_PIS_LIVE_APPROVED',
            'VB_SALT_EDGE_PIS_APP_ID',
            'VB_SALT_EDGE_PIS_SECRET',
            'VB_SALT_EDGE_PIS_PRIVATE_KEY',
            'VB_SALT_EDGE_PIS_CALLBACK_BASE_URL',
            'VB_SALT_EDGE_PIS_RETURN_URL',
        ];
        const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
        try {
            for (const name of names) delete process.env[name];
            expect(saltEdge.readiness().available).toBe(false);
            expect(saltEdge.readiness().reason).toBe('disabled-by-operator');
        } finally {
            for (const name of names) {
                if (previous[name] === undefined) delete process.env[name];
                else process.env[name] = previous[name];
            }
        }
    });
});
