'use strict';

const { isProductionRuntime, resolveDemoMode } = require('../config/database-mode');

describe('production database startup safety', () => {
    test('allows the in-memory demo store only outside production', () => {
        expect(resolveDemoMode({ NODE_ENV: 'test' })).toBe(true);
        expect(resolveDemoMode({ NODE_ENV: 'development' })).toBe(true);
    });

    test('fails closed when production has no DATABASE_URL', () => {
        expect(() => resolveDemoMode({ NODE_ENV: 'production' }))
            .toThrow('DATABASE_URL is required in production');
        expect(() => resolveDemoMode({ RENDER: 'true' }))
            .toThrow('DATABASE_URL is required in production');
        expect(() => resolveDemoMode({ RENDER_SERVICE_ID: 'srv-test' }))
            .toThrow('DATABASE_URL is required in production');
        expect(() => resolveDemoMode({ NODE_ENV: 'production', DATABASE_URL: '   ' }))
            .toThrow('DATABASE_URL is required in production');
    });

    test('uses PostgreSQL when a production DATABASE_URL is configured', () => {
        expect(resolveDemoMode({
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://vaultbank:example@db.example.test/vaultbank'
        })).toBe(false);
    });

    test('recognizes Render as production even if NODE_ENV is omitted', () => {
        expect(isProductionRuntime({ RENDER: 'true' })).toBe(true);
        expect(isProductionRuntime({ RENDER_SERVICE_ID: 'srv-test' })).toBe(true);
        expect(isProductionRuntime({ NODE_ENV: 'development' })).toBe(false);
    });
});
