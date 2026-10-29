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

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(endpoint: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  const path = endpoint.replace(/^\/+/, '');
  return `${base}/${path}`;
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('vaultbank_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(buildUrl(endpoint), { ...options, headers });
      const data = await response.json();
      if (!response.ok) {
        // Expired/invalidated session: clear cached credentials and return to
        // the login screen. Auth endpoints themselves are exempt - there a 401
        // means wrong credentials, not a dead session (no redirect loops).
        const isAuthCall = /(^|\/)(login|signup)(\/|$)/.test(endpoint);
        if (response.status === 401 && token && !isAuthCall) {
          for (const k of ['vaultbank_token', 'vaultbank_user', 'vaultbank_account']) localStorage.removeItem(k);
          window.location.href = '/';
        }
        throw new ApiError(data.message || 'Request failed', response.status);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.warn(`[API] Network error for ${endpoint} (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw new ApiError('Cannot reach the server. Please check your internet connection and try again.', 0);
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
    // The canonical route is /api/profile; /api/auth/me is not mounted.
    return request<ApiResponse>('api/profile');
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

  async initiatePayment(data: { method: string; amount: number; currency?: string; to?: string; metadata?: any }): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/transfer', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getPaymentHistory(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/history');
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

  async collectionsMyDetails(): Promise<ApiResponse> {
    return request<ApiResponse>('api/collections/my-details');
  },

  async createPayoutRequest(data: { amount: number; bankAccount: string; ifsc: string; address1: string; city: string; state: string; pincode: string }, idempotencyKey?: string): Promise<ApiResponse> {
    return request<ApiResponse>('api/payouts/requests', {
      method: 'POST',
      body: JSON.stringify(data),
      ...(idempotencyKey ? { headers: { 'idempotency-key': idempotencyKey } } : {}),
    });
  },

  async myPayouts(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payouts/requests');
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

  async stripeDeposit(data: { amount: number; currency?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/stripe/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async stripeWithdraw(data: { amount: number; bankAccountId?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/stripe/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async stripeBalance(): Promise<ApiResponse> {
    return request<ApiResponse>('api/stripe/balance');
  },

  async paypalDeposit(data: { amount: number; currency?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/paypal/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async paypalCapture(data: { orderId: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/paypal/capture', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Bank-transfer deposit rail — instructions + admin-verified settlement.
  async bankDepositConfig(): Promise<ApiResponse> {
    return request<ApiResponse>('api/bank-deposits/config');
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

  // REAL Stripe Issuing cards
  async getIssuingStatus(): Promise<ApiResponse> {
    return request<ApiResponse>('api/issuing/status');
  },

  async createCardholder(data: { line1?: string; city?: string; state?: string; postal_code?: string; country?: string; phone?: string; dob?: { day: number; month: number; year: number } }): Promise<ApiResponse> {
    return request<ApiResponse>('api/issuing/cardholder', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async issueCard(data: { network?: string; monthlyLimit?: number; perTransactionLimit?: number }): Promise<ApiResponse> {
    return request<ApiResponse>('api/issuing/cards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getIssuingCards(): Promise<ApiResponse> {
    return request<ApiResponse>('api/issuing/cards');
  },

  async freezeIssuingCard(id: string, frozen: boolean): Promise<ApiResponse> {
    return request<ApiResponse>(`api/issuing/cards/${id}/freeze`, {
      method: 'POST',
      body: JSON.stringify({ frozen }),
    });
  },

  async updateCardLimits(id: string, data: { monthlyLimit?: number; perTransactionLimit?: number }): Promise<ApiResponse> {
    return request<ApiResponse>(`api/issuing/cards/${id}/limits`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getCardEphemeralKey(id: string, apiVersion?: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/issuing/cards/${id}/ephemeral-key`, {
      method: 'POST',
      body: JSON.stringify({ apiVersion }),
    });
  },

  async getIssuingCardActivity(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/issuing/cards/${id}/transactions`);
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

  // VaultBank Pay — OUR OWN payment network
  async createVbPayMerchant(data: { name: string; category?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/vbpay/merchant', { method: 'POST', body: JSON.stringify(data) });
  },

  async getVbPayMerchant(): Promise<ApiResponse> {
    return request<ApiResponse>('api/vbpay/merchant');
  },

  async createVbPayRequest(data: { amount: number; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/vbpay/requests', { method: 'POST', body: JSON.stringify(data) });
  },

  async getVbPayRequests(): Promise<ApiResponse> {
    return request<ApiResponse>('api/vbpay/requests');
  },

  async payVbPayRequest(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/vbpay/requests/${id}/pay`, { method: 'POST', body: JSON.stringify({}) });
  },

  async getVbPayRequestPublic(id: string): Promise<ApiResponse> {
    return request<ApiResponse>(`api/vbpay/requests/${id}`);
  },

  // VaultBank Chain — outbound crypto
  async getChainStatus(): Promise<ApiResponse> {
    return request<ApiResponse>('api/usdc/withdraw-status');
  },

  async chainWithdraw(data: { to: string; amount: number; token?: string; network?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/usdc/withdraw', { method: 'POST', body: JSON.stringify(data) });
  },

  async healthCheck(): Promise<ApiResponse> {
    return request<ApiResponse>('health');
  },
};

export { ApiError };
export type { AuthResponse, ApiResponse };
