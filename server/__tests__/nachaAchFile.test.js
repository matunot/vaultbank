const { buildNachaCreditFile, validAbaRoutingNumber, parseUsdCents, parseEffectiveDate } = require('../services/nachaAchFile');

const CONFIG = {
  odfiRoutingNumber: '021000021',
  immediateOrigin: ' 021000021',
  odfiName: 'TEST ORIGINATING BANK',
  immediateOriginName: 'VAULTBANK ACH EXPORT',
  companyName: 'VAULTBANK',
  companyId: '1234567890',
  companyEntryDescription: 'PAYOUT',
};
const PAYOUT = {
  routingNumber: '021000021',
  accountNumber: '00123456789',
  accountType: 'checking',
  beneficiaryName: 'ALICE TEST',
  amount: '125.50',
  requestReference: 'VBUSD-ABC123',
};

describe('VaultBank NACHA ACH credit file generator', () => {
  test('formats 94-character ASCII records, control totals, and block-10 padding', () => {
    const result = buildNachaCreditFile({
      config: CONFIG, payouts: [PAYOUT], effectiveDate: '2026-10-30',
      fileIdModifier: 'A', traceSequenceStart: 1, now: new Date('2026-10-29T04:00:00Z'),
    });
    const rows = result.content.trimEnd().split('\r\n');
    expect(rows.length % 10).toBe(0);
    expect(result.recordCount).toBe(rows.length);
    expect(rows.every((row) => row.length === 94 && /^[\x20-\x7E]+$/.test(row))).toBe(true);
    expect(rows[0].slice(0, 3)).toBe('101');
    expect(rows[1].slice(0, 4)).toBe('5220');
    expect(rows[2].slice(0, 3)).toBe('622');
    expect(rows[2].slice(29, 39)).toBe('0000012550');
    expect(rows[2].slice(79, 94)).toBe('021000020000001');
    expect(rows[3].slice(0, 4)).toBe('8220');
    expect(rows[4].slice(0, 1)).toBe('9');
    expect(rows[4].slice(7, 13)).toBe(String(rows.length / 10).padStart(6, '0'));
    expect(rows.slice(5).every((row) => row === '9'.repeat(94))).toBe(true);
    expect(result.totalCredit).toBe('125.50');
    expect(result.entryCount).toBe(1);
    expect(result.traceNumbers).toEqual(['021000020000001']);
  });

  test('creates correct batch and file totals for several checking/savings credits', () => {
    const result = buildNachaCreditFile({
      config: CONFIG,
      payouts: [
        PAYOUT,
        { ...PAYOUT, accountType: 'savings', amount: '9.99', requestReference: 'VBUSD-ABC124', routingNumber: '011000015' },
      ],
      effectiveDate: '2026-10-30',
      fileIdModifier: 'B',
      traceSequenceStart: 42,
      now: new Date('2026-10-29T04:00:00Z'),
    });
    const rows = result.content.trimEnd().split('\r\n');
    expect(result.entryCount).toBe(2);
    expect(result.totalCredit).toBe('135.49');
    expect(rows[2].slice(1, 3)).toBe('22');
    expect(rows[3].slice(1, 3)).toBe('32');
    expect(rows[2].slice(79, 94)).toBe('021000020000042');
    expect(rows[3].slice(79, 94)).toBe('021000020000043');
    expect(rows[4].slice(5, 10)).toBe('000002');
    expect(rows[5].slice(32, 44)).toBe('0000000013549');
  });

  test('validates ABA checksum and exact cents without floating point', () => {
    expect(validAbaRoutingNumber('021000021')).toBe(true);
    expect(validAbaRoutingNumber('021000022')).toBe(false);
    expect(parseUsdCents('0.01')).toBe(1n);
    expect(parseUsdCents('125.5')).toBe(12550n);
    expect(() => parseUsdCents('1.009')).toThrow();
    expect(() => parseUsdCents('0')).toThrow();
  });

  test('rejects weekend, invalid, and past effective dates', () => {
    expect(parseEffectiveDate('2026-10-30', new Date('2026-10-29T04:00:00Z'))).toBe('2026-10-30');
    expect(() => parseEffectiveDate('2026-10-31', new Date('2026-10-29T04:00:00Z'))).toThrow(/weekend/);
    expect(() => parseEffectiveDate('2026-10-27', new Date('2026-10-29T04:00:00Z'))).toThrow(/past/);
    expect(() => parseEffectiveDate('2026-02-30', new Date('2026-02-01T00:00:00Z'))).toThrow(/valid calendar/);
  });

  test('rejects missing ODFI fields, invalid route/account, overlong fields and export sizes', () => {
    expect(() => buildNachaCreditFile({ config: { ...CONFIG, companyId: '' }, payouts: [PAYOUT], effectiveDate: '2026-10-30', fileIdModifier: 'A', now: new Date('2026-10-29T04:00:00Z') })).toThrow(/Company ID/i);
    expect(() => buildNachaCreditFile({ config: CONFIG, payouts: [{ ...PAYOUT, routingNumber: '021000022' }], effectiveDate: '2026-10-30', fileIdModifier: 'A', now: new Date('2026-10-29T04:00:00Z') })).toThrow(/routing number/i);
    expect(() => buildNachaCreditFile({ config: CONFIG, payouts: [{ ...PAYOUT, accountNumber: 'X'.repeat(18) }], effectiveDate: '2026-10-30', fileIdModifier: 'A', now: new Date('2026-10-29T04:00:00Z') })).toThrow(/account number/i);
    expect(() => buildNachaCreditFile({ config: CONFIG, payouts: [{ ...PAYOUT, beneficiaryName: 'ALICE\nTEST' }], effectiveDate: '2026-10-30', fileIdModifier: 'A', now: new Date('2026-10-29T04:00:00Z') })).toThrow(/characters not allowed/i);
    expect(() => buildNachaCreditFile({ config: CONFIG, payouts: [], effectiveDate: '2026-10-30', fileIdModifier: 'A' })).toThrow(/between 1 and/);
  });
});
