/**
 * VaultBank API Service
 * Handles all communication with the backend server
 */

// Use local dev server during development, production URL otherwise.
// Local dev: Vite proxies /api to localhost:5000. To connect to a local backend
// directly, set VITE_API_URL=http://localhost:5000.
const API_BASE = (import.meta.env?.VITE_API_URL as string) || (import.meta.env?.DEV ? '' : 'https://vaultbank-md20.onrender.com');

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    full_name?: string;
    fullName?: string;
    role?: string;
    emailVerified?: boolean;
    kycStatus?: string;
  };
  account?: {
    id: string;
    accountNumber: string;
    accountType: string;
    balance: number;
    availableBalance?: number;
    currency: string;
    status?: string;
  };
  message?: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  [key: string]: any;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

/**
 * Networking policy
 * -----------------
 * - GET/HEAD/OPTIONS may be retried (safe methods).
 * - Mutations are retried ONLY when the caller supplies an Idempotency-Key;
 *   replaying a money POST without one can move funds twice.
 * - Every request gets a timeout and a correlation ID. A shared in-flight map
 *   de-duplicates concurrent GETs (dashboard mounts used to fire the same
 *   account reads several times).
 * - Timing samples are kept in memory, keyed by normalized route (no query
 *   strings, no balances, no identifiers).
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RETRY_DELAY_MS = 1200;
const MAX_SAFE_RETRIES = 1;
const GET_TIMEOUT_MS = 12000;
const MUTATION_TIMEOUT_MS = 45000;
const MAX_TIMING_SAMPLES = 400;

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

interface TimingSample { key: string; ms: number; status: number }

const timingSamples: TimingSample[] = [];
const inflight = new Map<string, Promise<any>>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(endpoint: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const path = endpoint.replace(/^\/+/, '');
  return `${base}/${path}`;
}

/** Normalize a route for metrics: drop query/hash and collapse identifiers. */
export function apiRouteKey(endpoint: string, method = 'GET'): string {
  const path = endpoint.split(/[?#]/)[0].replace(/^\/+/, '');
  const normalized = path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
  return `${method.toUpperCase()} /${normalized}`;
}

function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `vb-${crypto.randomUUID()}`;
    }
  } catch { /* fall through */ }
  return `vb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function recordTiming(key: string, ms: number, status: number): void {
  timingSamples.push({ key, ms, status });
  if (timingSamples.length > MAX_TIMING_SAMPLES) timingSamples.shift();
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export interface ApiTimingSummary {
  key: string;
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
}

/** In-memory latency summary for diagnostics and regression tests. */
export function getApiTimingStats(): ApiTimingSummary[] {
  const byKey = new Map<string, { values: number[]; errors: number }>();
  for (const sample of timingSamples) {
    const entry = byKey.get(sample.key) || { values: [], errors: 0 };
    entry.values.push(sample.ms);
    if (sample.status === 0 || sample.status >= 400) entry.errors += 1;
    byKey.set(sample.key, entry);
  }
  return Array.from(byKey.entries())
    .map(([key, { values, errors }]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return {
        key,
        count: sorted.length,
        errors,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        p99: Math.round(percentile(sorted, 99)),
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}

export function resetApiTimingStats(): void {
  timingSamples.length = 0;
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Never surface a raw HTML error page to the UI.
    return { message: response.ok ? undefined : 'Unexpected server response' };
  }
}

async function performRequest<T>(endpoint: string, options: RequestOptions): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const token = localStorage.getItem('vaultbank_token');
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const idempotencyKey = readHeader(headers, 'Idempotency-Key');
  const canRetry = SAFE_METHODS.has(method) || Boolean(idempotencyKey);
  const maxAttempts = canRetry ? MAX_SAFE_RETRIES + 1 : 1;
  const timeoutMs = options.timeoutMs ?? (method === 'GET' ? GET_TIMEOUT_MS : MUTATION_TIMEOUT_MS);
  const key = apiRouteKey(endpoint, method);
  const requestId = newRequestId();
  const startedAt = performance.now();

  let status = 0;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const externalSignal = options.signal;
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort);

      try {
        const response = await fetch(buildUrl(endpoint), {
          ...options,
          headers: { ...headers, 'X-Request-ID': requestId },
          signal: controller.signal,
        });
        status = response.status;
        const data = await parseResponse(response);
        if (!response.ok) {
          // Expired/invalidated session: clear cached credentials and return to
          // the login screen. Auth endpoints themselves are exempt - there a 401
          // means wrong credentials, not a dead session (no redirect loops).
          const isAuthCall = /(^|\/)(login|signup)(\/|$)/.test(endpoint);
          if (response.status === 401 && token && !isAuthCall) {
            for (const k of ['vaultbank_token', 'vaultbank_user', 'vaultbank_account']) localStorage.removeItem(k);
            window.location.href = '/';
          }
          throw new ApiError(data?.message || 'Request failed', response.status);
        }
        return data as T;
      } catch (error) {
        if (error instanceof ApiError) throw error;

        const userAborted = externalSignal?.aborted;
        if (userAborted) {
          throw new ApiError('Request cancelled', 0);
        }
        if (timedOut) {
          // A timed-out mutation is ambiguous on the server. Never replay it
          // unless the request carries an idempotency key.
          throw new ApiError('The server took too long to respond. Please check your connection and try again.', 0);
        }

        status = 0;
        if (import.meta.env?.DEV) {
          console.warn(`[API] Network error on ${key} (attempt ${attempt + 1}/${maxAttempts})`);
        }
        if (attempt + 1 >= maxAttempts) {
          throw new ApiError('Cannot reach the server. Please check your internet connection and try again.', 0);
        }
        await delay(RETRY_DELAY_MS);
      } finally {
        window.clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    }
    // Unreachable, but keeps TypeScript satisfied.
    throw new ApiError('Cannot reach the server. Please check your internet connection and try again.', 0);
  } finally {
    recordTiming(key, performance.now() - startedAt, status);
  }
}

async function request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  if (!SAFE_METHODS.has(method) || options.signal) {
    return performRequest<T>(endpoint, options);
  }

  const token = localStorage.getItem('vaultbank_token');
  const dedupeKey = `${method} ${buildUrl(endpoint)} ${token ? token.slice(-8) : 'anon'}`;
  const existing = inflight.get(dedupeKey);
  if (existing) return existing as Promise<T>;

  let pending: Promise<T>;
  pending = performRequest<T>(endpoint, options).finally(() => {
    if (inflight.get(dedupeKey) === pending) inflight.delete(dedupeKey);
  });
  inflight.set(dedupeKey, pending);
  return pending;
}

export const api = {
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const result = await request<AuthResponse>('login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (result.token) {
        localStorage.setItem('vaultbank_token', result.token);
        if (result.user) localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
        if (result.account) localStorage.setItem('vaultbank_account', JSON.stringify(result.account));
      }
      return result;
    } catch (error) {
      throw error;
    }
  },

  async signup(email: string, password: string, fullName?: string): Promise<AuthResponse> {
    try {
      const result = await request<AuthResponse>('signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName }),
      });
      if (result.token) {
        localStorage.setItem('vaultbank_token', result.token);
        if (result.user) localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
        if (result.account) localStorage.setItem('vaultbank_account', JSON.stringify(result.account));
      }
      return result;
    } catch (error) {
      throw error;
    }
  },

  async adminLogin(email: string, password: string): Promise<AuthResponse> {
    try {
      const result = await request<AuthResponse>('api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (result.token) {
        localStorage.setItem('vaultbank_token', result.token);
        if (result.user) localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
        if (result.account) localStorage.setItem('vaultbank_account', JSON.stringify(result.account));
      }
      return result;
    } catch (error) {
      throw error;
    }
  },

  logout(): void {
    localStorage.removeItem('vaultbank_token');
    localStorage.removeItem('vaultbank_user');
    localStorage.removeItem('vaultbank_account');
  },

  getToken(): string | null {
    return localStorage.getItem('vaultbank_token');
  },

  getUser(): any | null {
    const user = localStorage.getItem('vaultbank_user');
    return user ? JSON.parse(user) : null;
  },

  getAccount(): any | null {
    const account = localStorage.getItem('vaultbank_account');
    return account ? JSON.parse(account) : null;
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('vaultbank_token');
  },

  async getProfile(): Promise<ApiResponse> {
    // This authenticated endpoint returns the current persisted user and KYC/email-verification state.
    return request<ApiResponse>('api/auth/me');
  },

  async requestEmailVerification(): Promise<ApiResponse> {
    return request<ApiResponse>('api/auth/email-verification/request', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async confirmEmailVerification(token: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/auth/email-verification/confirm', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  async getKycStatus(): Promise<ApiResponse> {
    return request<ApiResponse>('api/kyc');
  },

  async uploadKycDocument(file: File, documentType: string): Promise<ApiResponse> {
    const body = new FormData();
    body.append('documentType', documentType);
    body.append('document', file, file.name);
    return request<ApiResponse>('api/kyc', {
      method: 'POST',
      body,
      timeoutMs: 60000,
    });
  },

  async getAdminKycQueue(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<ApiResponse> {
    return request<ApiResponse>(`api/admin/kyc?status=${encodeURIComponent(status)}`);
  },

  async approveKycDocument(id: string, note = ''): Promise<ApiResponse> {
    return request<ApiResponse>(`api/kyc/${encodeURIComponent(id)}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    });
  },

  async rejectKycDocument(id: string, note: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/kyc/${encodeURIComponent(id)}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ note }),
    });
  },

  async downloadKycDocument(id: string): Promise<Blob> {
    const token = localStorage.getItem('vaultbank_token');
    const response = await fetch(buildUrl(`api/kyc/${encodeURIComponent(id)}/file`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      let message = 'Could not load the identity document.';
      try {
        const data = await response.json();
        if (data?.message) message = data.message;
      } catch { /* keep the generic message */ }
      throw new ApiError(message, response.status);
    }
    return response.blob();
  },

  async getAccounts(): Promise<ApiResponse> {
    return request<ApiResponse>('api/accounts');
  },

  async getSavingsAccounts(): Promise<ApiResponse> {
    return request<ApiResponse>('api/savings/accounts');
  },

  async openSavingsAccount(data: { currency: 'USD' | 'INR' }): Promise<ApiResponse> {
    return request<ApiResponse>('api/savings/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async moveSavings(
    data: { fromAccountId: string; toAccountId: string; amount: number },
    idempotencyKey: string,
  ): Promise<ApiResponse> {
    return request<ApiResponse>('api/savings/move', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  async getCardProgramRequests(): Promise<ApiResponse> {
    return request<ApiResponse>('api/card-program/requests');
  },

  async requestCardProgram(
    data: { cardType: 'debit' | 'credit'; currency: 'INR' | 'USD' },
    idempotencyKey: string,
  ): Promise<ApiResponse> {
    return request<ApiResponse>('api/card-program/requests', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  async getLoanApplications(): Promise<ApiResponse> {
    return request<ApiResponse>('api/loan-applications');
  },

  async submitLoanApplication(
    data: { amount: number; currency: 'INR' | 'USD'; termMonths: number; purpose: string },
    idempotencyKey: string,
  ): Promise<ApiResponse> {
    return request<ApiResponse>('api/loan-applications', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  async getAdminCardProgramRequests(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/card-program/requests');
  },

  async updateAdminCardProgramRequest(
    id: string,
    data: { status: string; note: string },
  ): Promise<ApiResponse> {
    return request<ApiResponse>(`api/admin/card-program/requests/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getAdminLoanApplications(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/loan-applications');
  },

  async updateAdminLoanApplication(
    id: string,
    data: { status: string; note: string },
  ): Promise<ApiResponse> {
    return request<ApiResponse>(`api/admin/loan-applications/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async fetchAccount(): Promise<ApiResponse> {
    return request<ApiResponse>('api/account');
  },

  async getAccountBalance(): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/balance');
  },

  async getAccountTransactions(limit = 50): Promise<ApiResponse> {
    return request<ApiResponse>(`api/account/transactions?limit=${limit}`);
  },

  async getTransfers(): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers');
  },

  async createTransfer(data: { toAccountId?: string; amount: number; currency?: string; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getTransferHistory(): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers/history');
  },

  async getRewards(): Promise<ApiResponse> {
    return request<ApiResponse>('api/rewards/me');
  },

  async getLeaderboard(): Promise<ApiResponse> {
    return request<ApiResponse>('api/rewards/leaderboard');
  },

  async redeemReward(points: number): Promise<ApiResponse> {
    return request<ApiResponse>('api/rewards/redeem', {
      method: 'POST',
      body: JSON.stringify({ points }),
    });
  },

  async getAlerts(): Promise<ApiResponse> {
    return request<ApiResponse>('api/alerts');
  },

  async getUnreadCount(): Promise<ApiResponse> {
    return request<ApiResponse>('api/alerts/unread-count');
  },

  async markAlertRead(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/alerts/${id}/read`, { method: 'PUT' });
  },

  async markAllAlertsRead(): Promise<ApiResponse> {
    return request<ApiResponse>('api/alerts/read-all', { method: 'PUT' });
  },

  async getInvestments(): Promise<ApiResponse> {
    return request<ApiResponse>('api/investments/me');
  },

  async addInvestment(data: { type: string; amount: number; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/investments/add', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getPaymentMethods(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/methods');
  },

  async getWalletBalance(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/wallet/balance');
  },

  async searchUsers(q: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/account/users/search?q=${encodeURIComponent(q)}`);
  },

  async sendMoney(data: { recipientEmail?: string; recipientAccountNumber?: string; amount: number; description?: string; currency?: string }, idempotencyKey?: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
      ...(idempotencyKey ? { headers: { 'idempotency-key': idempotencyKey } } : {}),
    });
  },

  // ── Unified USD + INR payments core ────────────────────────────────────────
  async paymentsReadiness(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/readiness');
  },

  async openInrAccount(): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/open-inr', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async getInrAccount(): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/inr');
  },

  async getCurrencies(): Promise<ApiResponse> {
    return request<ApiResponse>('api/currencies');
  },

  async getCurrencyWallet(currency: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/account/wallet/${encodeURIComponent(currency)}`);
  },

  async openCurrencyAccount(currency: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/open-currency', {
      method: 'POST',
      body: JSON.stringify({ currency }),
    });
  },

  async accountDeposit(data: { amount: number; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async accountWithdraw(data: { amount: number; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/account/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Bank-transfer deposit rail — instructions + admin-verified settlement.
  async bankDepositConfig(currency?: string): Promise<ApiResponse> {
    const query = currency ? `?currency=${encodeURIComponent(currency)}` : '';
    return request<ApiResponse>(`api/bank-deposits/config${query}`);
  },

  async createBankDepositInstruction(data: { amount: number; currency?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/bank-deposits/instructions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getBankDepositInstruction(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/instructions/${id}`);
  },

  async bankDepositInstructions(): Promise<ApiResponse> {
    return request<ApiResponse>('api/bank-deposits/instructions');
  },

  async cancelBankDepositInstruction(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/instructions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async bankDepositAdminInstructions(status = 'pending'): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/admin/instructions?status=${encodeURIComponent(status)}`);
  },

  async verifyBankDepositInstruction(id: string, data: { settlementAmount: string; externalTxnRef: string; note: string }): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/admin/instructions/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async failBankDepositInstruction(id: string, note: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/admin/instructions/${encodeURIComponent(id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async reverseBankDepositInstruction(id: string, note: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/bank-deposits/admin/instructions/${encodeURIComponent(id)}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  // VaultBank-owned Direct UPI rail (QR is generated locally by the server; settlement is statement-verified).
  async directUpiConfig(): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-upi/config');
  },

  async createDirectUpiIntent(data: { amount: number }, idempotencyKey: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-upi/intents', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  async directUpiIntents(): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-upi/intents');
  },

  async directUpiAdminIntents(status = 'pending'): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-upi/admin/intents?status=${encodeURIComponent(status)}`);
  },

  async verifyDirectUpiIntent(id: string, data: { settlementAmount: string; bankUtr: string; evidenceNote: string }): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-upi/admin/intents/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async failDirectUpiIntent(id: string, note: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-upi/admin/intents/${encodeURIComponent(id)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  // VaultBank-owned manual bank payout rail. Requests reserve funds; the operator sends via the bank and confirms the bank-statement UTR.
  async directBankPayoutAvailability(): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-bank-payouts/availability');
  },

  async createDirectBankPayoutRequest(data: { amount: number; beneficiaryName: string; bankAccount: string; ifsc: string }, idempotencyKey: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-bank-payouts/requests', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    });
  },

  async directBankPayoutRequests(): Promise<ApiResponse> {
    return request<ApiResponse>('api/direct-bank-payouts/requests');
  },

  async directBankPayoutAdminRequests(status = 'reserved'): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-bank-payouts/admin/requests?status=${encodeURIComponent(status)}`);
  },

  async confirmDirectBankPayoutRequest(id: string, data: { settlementAmount: string; bankUtr: string; evidenceNote: string }): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-bank-payouts/admin/requests/${encodeURIComponent(id)}/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async refundDirectBankPayoutRequest(id: string, evidenceNote: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/direct-bank-payouts/admin/requests/${encodeURIComponent(id)}/refund`, {
      method: 'POST',
      body: JSON.stringify({ evidenceNote }),
    });
  },

  async usdcAddress(network?: string, token?: string): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (network) params.set('network', network);
    if (token) params.set('token', token);
    const qs = params.toString();
    return request<ApiResponse>(`api/usdc/deposit-address${qs ? `?${qs}` : ''}`);
  },

  async usdcCheck(network?: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/usdc/check', {
      method: 'POST',
      body: JSON.stringify(network ? { network } : {}),
    });
  },

  async getAdminStats(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/stats');
  },

  async getAdminUsers(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/users');
  },

  async getAdminTransactions(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/transactions');
  },

  // VaultBank Credit Engine
  async getCreditStatus(): Promise<ApiResponse> {
    return request<ApiResponse>('api/credit/status');
  },

  async applyCredit(): Promise<ApiResponse> {
    return request<ApiResponse>('api/credit/apply', { method: 'POST', body: JSON.stringify({}) });
  },

  async repayCredit(data: { amount: number }): Promise<ApiResponse> {
    return request<ApiResponse>('api/credit/repay', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async toggleCreditAutopay(autopay: boolean): Promise<ApiResponse> {
    return request<ApiResponse>('api/credit/autopay', {
      method: 'POST',
      body: JSON.stringify({ autopay }),
    });
  },

  // VaultBank Chain — outbound crypto
  async getChainStatus(): Promise<ApiResponse> {
    return request<ApiResponse>('api/usdc/withdraw-status');
  },

  async chainWithdraw(data: { to: string; amount: number; token?: string; network?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/usdc/withdraw', { method: 'POST', body: JSON.stringify(data) });
  },

  // Native USD ACH preparation. A generated NACHA file is not settlement proof.
  async usdAchAvailability(): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/availability');
  },
  async createUsdAchPayout(data: { amount: string; beneficiaryName: string; routingNumber: string; accountNumber: string; accountType: 'checking' | 'savings'; authorizationAccepted: boolean }, idempotencyKey: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/payouts', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) });
  },
  async usdAchPayoutRequests(): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/payouts');
  },
  async usdAchAdminRequests(status = 'reserved'): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/requests?status=' + encodeURIComponent(status));
  },
  async approveUsdAchPayout(id: string, note: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/requests/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: JSON.stringify({ note }) });
  },
  async createUsdAchBatch(data: { requestIds: string[]; effectiveDate: string }, idempotencyKey: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/batches', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) });
  },
  async usdAchAdminBatches(): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/batches');
  },
  async usdAchAdminBatchFile(id: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/batches/' + encodeURIComponent(id) + '/file');
  },
  async rejectUsdAchBatch(id: string, evidenceNote: string, confirmedNotAccepted: boolean): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/batches/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: JSON.stringify({ evidenceNote, confirmedNotAccepted }) });
  },
  async settleUsdAchPayout(id: string, data: { settlementAmount: string; bankReference: string; evidenceNote: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/requests/' + encodeURIComponent(id) + '/settle', { method: 'POST', body: JSON.stringify(data) });
  },
  async refundUsdAchPayout(id: string, evidenceNote: string, bankConfirmedNotSent: boolean): Promise<ApiResponse> {
    return request<ApiResponse>('api/usd-ach/admin/requests/' + encodeURIComponent(id) + '/refund', { method: 'POST', body: JSON.stringify({ evidenceNote, bankConfirmedNotSent }) });
  },

  async healthCheck(): Promise<ApiResponse> {
    return request<ApiResponse>('health');
  },
};

export { ApiError };
export type { AuthResponse, ApiResponse };
