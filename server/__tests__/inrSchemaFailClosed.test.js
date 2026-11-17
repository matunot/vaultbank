/**
 * Native INR schema readiness tests.
 *
 * Verifies required migrations, tables, indexes and columns using a read-only
 * fake database seam. No provider adapter or payment gateway is involved.
 */
const {
  checkSchema,
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLES,
  REQUIRED_INDEXES,
  REQUIRED_COLUMNS,
} = require('../utils/schemaReadiness');

function fakeDb({ missingTable = null, missingIndex = null, nonUniqueIndex = null, missingColumn = null, missingMigration = null } = {}) {
  return {
    query: jest.fn(async (sql, params) => {
      if (sql.includes('to_regclass') && sql.includes('_migrations')) return { rows: [{ present: true }] };
      if (sql.includes('SELECT filename FROM _migrations')) {
        return { rows: REQUIRED_MIGRATIONS.filter((filename) => filename !== missingMigration).map((filename) => ({ filename })) };
      }
      if (sql.includes('t.name')) {
        return { rows: params[0].map((name) => ({ name, present: name !== missingTable })) };
      }
      if (sql.includes('i.name')) {
        return { rows: params[0].map((name) => ({ name, present: name !== missingIndex, is_unique: name !== nonUniqueIndex })) };
      }
      if (sql.includes('information_schema.columns')) {
        const rows = [];
        for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
          for (const col of cols) {
            if (table === missingTable || (table === 'accounts' && col === missingColumn)) continue;
            rows.push({ table_name: table, column_name: col });
          }
        }
        return { rows };
      }
      throw new Error('unexpected SQL: ' + sql);
    }),
  };
}

describe('native schema readiness', () => {
  test('ready:true requires every migration, table, index and column', async () => {
    const result = await checkSchema(fakeDb());
    expect(result.ready).toBe(true);
    expect(result.migrations.missing).toEqual([]);
    expect(REQUIRED_TABLES.every((table) => result.tables[table] === true)).toBe(true);
    expect(REQUIRED_INDEXES.every((index) => result.indexes[index] === true)).toBe(true);
  });

  test('a missing migration is not ready', async () => {
    const result = await checkSchema(fakeDb({ missingMigration: REQUIRED_MIGRATIONS[0] }));
    expect(result.ready).toBe(false);
    expect(result.migrations.missing).toContain(REQUIRED_MIGRATIONS[0]);
  });

  test('a missing unique index is not ready and names the index', async () => {
    const result = await checkSchema(fakeDb({ missingIndex: 'vb_ledger_customer_account_uq' }));
    expect(result.ready).toBe(false);
    expect(result.indexes.vb_ledger_customer_account_uq).toBe(false);
    expect(result.notes.join(' ')).toContain('vb_ledger_customer_account_uq');
  });

  test('a same-named non-unique index is not ready', async () => {
    const result = await checkSchema(fakeDb({ nonUniqueIndex: 'vb_ledger_customer_account_uq' }));
    expect(result.ready).toBe(false);
    expect(result.indexes.vb_ledger_customer_account_uq).toBe(true);
    expect(result.indexUnique.vb_ledger_customer_account_uq).toBe(false);
    expect(result.notes.join(' ')).toContain('not unique');
  });

  test('a missing native ledger table blocks readiness', async () => {
    const result = await checkSchema(fakeDb({ missingTable: 'vb_ledger_entries' }));
    expect(result.ready).toBe(false);
    expect(result.tables.vb_ledger_entries).toBe(false);
    expect(result.notes.join(' ')).toContain('vb_ledger_entries');
  });

  test('a missing required account column blocks readiness', async () => {
    const result = await checkSchema(fakeDb({ missingColumn: 'available_balance' }));
    expect(result.ready).toBe(false);
    expect(result.columns.accounts.available_balance).toBe(false);
  });
});
