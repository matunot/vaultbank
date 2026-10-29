jest.mock('../config/database', () => ({
  db: { query: jest.fn(), ensureConnection: jest.fn(), getClient: jest.fn() },
  findUserById: jest.fn(), createNotification: jest.fn().mockResolvedValue(undefined), createAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/ledgerJournalService', () => ({
  ensureVaultLedgerSchema: jest.fn().mockResolvedValue(undefined), ensureCustomerLedgerAccount: jest.fn().mockResolvedValue(undefined),
  changeVerifiedAvailableBalance: jest.fn().mockResolvedValue(undefined), postBalancedJournal: jest.fn().mockResolvedValue({ journalId: 'journal-1', replay: false }),
  toMinorUnits: (value) => BigInt(Math.round(Number(value) * 100)),
}));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => { if (!req.user) req.user = { id: 'user-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => { if (!req.user || !['admin','super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access required.' }); next(); },
}));
const CDB = require('../config/database');
const ledger = require('../services/ledgerJournalService');
const router = require('../routes/usd-ach-payouts');
const ENV_KEYS = ['VB_USD_ACH_EXPORT_ENABLED','VB_USD_ACH_CUSTOMER_ACCESS_ENABLED','VB_USD_ACH_ENCRYPTION_KEY','VB_USD_ACH_ODFI_ROUTING_NUMBER','VB_USD_ACH_IMMEDIATE_ORIGIN','VB_USD_ACH_ODFI_NAME','VB_USD_ACH_IMMEDIATE_ORIGIN_NAME','VB_USD_ACH_COMPANY_NAME','VB_USD_ACH_COMPANY_ID','VB_USD_ACH_ENTRY_DESCRIPTION'];
const SAVED = {};
for (const key of ENV_KEYS) { SAVED[key] = process.env[key]; delete process.env[key]; }
afterAll(() => { for (const [key,value] of Object.entries(SAVED)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
function enable({customerAccess=false}={}) {
  Object.assign(process.env,{VB_USD_ACH_EXPORT_ENABLED:'true',VB_USD_ACH_ENCRYPTION_KEY:'ab'.repeat(32),VB_USD_ACH_ODFI_ROUTING_NUMBER:'021000021',VB_USD_ACH_IMMEDIATE_ORIGIN:' 021000021',VB_USD_ACH_ODFI_NAME:'TEST ORIGINATING BANK',VB_USD_ACH_IMMEDIATE_ORIGIN_NAME:'VAULTBANK ACH EXPORT',VB_USD_ACH_COMPANY_NAME:'VAULTBANK',VB_USD_ACH_COMPANY_ID:'1234567890',VB_USD_ACH_ENTRY_DESCRIPTION:'PAYOUT'});
  if(customerAccess)process.env.VB_USD_ACH_CUSTOMER_ACCESS_ENABLED='true';
}
function mockResponse() { const res={statusCode:null,body:null};res.status=jest.fn(code=>{res.statusCode=code;return res;});res.json=jest.fn(body=>{res.body=body;return res;});return res; }
async function call(path,options={}) {
  const method=String(options.method||'get').toLowerCase();
  const layer=router.stack.find(item=>item.route&&item.route.path===path&&item.route.methods[method]);
  if(!layer)throw new Error('Missing route '+method.toUpperCase()+' '+path);
  const req={method:method.toUpperCase(),user:options.user,headers:options.headers||{},body:options.body||{},query:options.query||{},params:options.params||{},ip:'127.0.0.1'};
  const res=mockResponse();let next=true;const handlers=layer.route.stack.map(item=>item.handle);
  for(let i=0;i<handlers.length-1&&next;i++){next=false;await handlers[i](req,res,()=>{next=true;});}if(next)await handlers[handlers.length-1](req,res,()=>{});return res;
}
beforeEach(()=>{jest.clearAllMocks();for(const key of ENV_KEYS)delete process.env[key];CDB.db.ensureConnection.mockResolvedValue(undefined);CDB.db.query.mockResolvedValue({rows:[]});});

describe('native USD ACH payout preparation',()=>{
 test('defaults closed and exposes no configuration secrets',async()=>{
  expect(router.readiness().available).toBe(false);expect(router.readiness().automaticTransfer).toBe(false);
  const res=await call('/api/usd-ach/availability');expect(res.statusCode).toBe(200);expect(res.body.available).toBe(false);expect(CDB.db.query).not.toHaveBeenCalled();
 });
 test('rejects requests until authorized ODFI profile is configured',async()=>{
  const res=await call('/api/usd-ach/payouts',{method:'post',headers:{'idempotency-key':'usd-ach-test-001'},body:{amount:'25.00',beneficiaryName:'Alice Test',routingNumber:'021000021',accountNumber:'0012345',accountType:'checking',authorizationAccepted:true}});
  expect(res.statusCode).toBe(503);expect(res.body.code).toBe('USD_ACH_EXPORT_NOT_CONFIGURED');expect(CDB.db.query).not.toHaveBeenCalled();
 });
 test('customer access remains closed unless operator enables it',async()=>{
  enable();const res=await call('/api/usd-ach/payouts',{method:'post',user:{id:'customer-1',role:'user',email_verified:true,kyc_status:'verified'},headers:{'idempotency-key':'usd-ach-customer-001'},body:{amount:'25.00',beneficiaryName:'Alice Test',routingNumber:'021000021',accountNumber:'0012345',accountType:'checking',authorizationAccepted:true}});
  expect(res.statusCode).toBe(403);expect(res.body.code).toBe('USD_ACH_CUSTOMER_ACCESS_DISABLED');expect(CDB.db.query).not.toHaveBeenCalled();
 });
 test('rejects invalid ABA routing checksum before touching payout storage',async()=>{
  enable({customerAccess:true});CDB.findUserById.mockResolvedValue({id:'customer-1',full_name:'Alice Test'});
  const res=await call('/api/usd-ach/payouts',{method:'post',user:{id:'customer-1',role:'user',email_verified:true,kyc_status:'verified'},headers:{'idempotency-key':'usd-ach-routing-001'},body:{amount:'25.00',beneficiaryName:'Alice Test',routingNumber:'021000022',accountNumber:'0012345',accountType:'checking',authorizationAccepted:true}});
  expect(res.statusCode).toBe(400);expect(res.body.code).toBe('USD_ACH_ROUTING_INVALID');expect(CDB.db.query).not.toHaveBeenCalled();
 });
 test('reserves externally verified USD with a balanced payable journal and idempotency',async()=>{
  enable({customerAccess:true});CDB.findUserById.mockResolvedValue({id:'customer-1',full_name:'Alice Test'});
  const client={query:jest.fn(async(sql,params=[])=>{
   const t=String(sql);if(t==='BEGIN'||t==='COMMIT'||t==='ROLLBACK'||t.includes('pg_advisory_xact_lock'))return {rows:[]};
   if(t.includes('SELECT id, balance::text AS balance'))return {rows:[{id:'account-usd-1',balance:'500.00',available_balance:'500.00',currency:'USD',status:'active'}]};
   if(t.includes('INSERT INTO usd_ach_payout_requests'))return {rows:[{id:'request-1',user_id:'customer-1',account_id:'account-usd-1',request_reference:'VBACH-TEST1234',amount:params[4],currency:'USD',beneficiary_name:params[5],destination_account_masked:params[8],destination_routing_masked:params[9],account_type:params[10],status:'reserved'}]};
   if(t.includes('UPDATE accounts SET balance = balance -'))return {rows:[{balance_before:'500.00',balance_after:'475.00'}]};return {rows:[]};
  }),release:jest.fn()};
  CDB.db.getClient.mockResolvedValue(client);CDB.db.query.mockResolvedValue({rows:[]});
  const res=await call('/api/usd-ach/payouts',{method:'post',user:{id:'customer-1',role:'user',email_verified:true,kyc_status:'verified'},headers:{'idempotency-key':'usd-ach-positive-001'},body:{amount:'25.00',beneficiaryName:'Alice Test',routingNumber:'021000021',accountNumber:'0012345',accountType:'checking',authorizationAccepted:true}});
  expect(res.statusCode).toBe(201);expect(res.body.request.status).toBe('reserved');expect(res.body.message).toContain('has not been sent');
  expect(ledger.changeVerifiedAvailableBalance).toHaveBeenCalledWith(client,'account-usd-1','25.00','debit');
  expect(ledger.postBalancedJournal).toHaveBeenCalledWith(client,expect.objectContaining({eventType:'payout_reserved',sourceType:'usd_ach_payout',currency:'USD'}));
  expect(res.body.request.destinationAccountNumber).toBeUndefined();expect(res.body.request.destinationAccountMasked).toBe('****2345');expect(client.release).toHaveBeenCalled();
 });
});
