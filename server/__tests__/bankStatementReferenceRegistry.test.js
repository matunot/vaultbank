jest.mock('../config/database', () => ({
  db: { query: jest.fn(), ensureConnection: jest.fn().mockResolvedValue(undefined) },
}));
const { db } = require('../config/database');
const registry = require('../services/bankStatementReferenceRegistry');

describe('global bank-statement reference registry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('to_regclass')) return { rows: [{ present: true }] };
      return { rows: [] };
    });
  });

  test('creates global UTR uniqueness and backfills settled evidence from both native rails', async () => {
    await registry.ensureBankSettlementReferenceRegistry();
    const sql = db.query.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS vb_bank_settlement_references');
    expect(sql).toContain('ON vb_bank_settlement_references (normalized_reference)');
    expect(sql).toContain('FROM bank_deposit_instructions');
    expect(sql).toContain('FROM direct_upi_deposit_intents');
    expect(sql).toContain("status IN ('settled', 'settling')");
    expect(db.ensureConnection).toHaveBeenCalledTimes(1);
  });

  test('normalizes UTR in the caller transaction and records rail provenance', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    await registry.claimBankStatementReference(client, {
      currency: 'inr', bankReference: '  utr-test-1234  ', sourceType: 'direct_upi_deposit',
      sourceId: '00000000-0000-4000-8000-000000000001',
      accountId: '00000000-0000-4000-8000-000000000002',
      userId: '00000000-0000-4000-8000-000000000003',
      amount: '125.50', adminId: '00000000-0000-4000-8000-000000000004',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO vb_bank_settlement_references'),
      ['INR', 'utr-test-1234', 'UTR-TEST-1234', 'direct_upi_deposit',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003', '125.50',
        '00000000-0000-4000-8000-000000000004']
    );
  });

  test('rejects unsupported currencies and malformed references before SQL writes', async () => {
    const client = { query: jest.fn() };
    const base = { sourceType: 'direct_upi_deposit', sourceId: 'source', accountId: 'account',
      userId: 'user', amount: '10.00', adminId: 'admin', bankReference: 'UTR-TEST-1234' };
    await expect(registry.claimBankStatementReference(client, { ...base, currency: 'EUR' })).rejects.toThrow('Unsupported bank-statement currency');
    await expect(registry.claimBankStatementReference(client, { ...base, currency: 'INR', bankReference: 'bad ref' })).rejects.toThrow('Invalid bank-statement reference');
    expect(client.query).not.toHaveBeenCalled();
  });
});
