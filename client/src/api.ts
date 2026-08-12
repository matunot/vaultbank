/**
 * VaultBank API Service
 * Handles all communication with the backend server
 */

const API_BASE = 'https://vaultbank-md20.onrender.com';

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    full_name?: string;
    role?: string;
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

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('vaultbank_token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Retry on network errors (e.g. Render free-tier cold starts)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(data.message || 'Request failed', response.status);
      }

      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      // Network error (TypeError: Failed to fetch) — retry a couple times
      console.warn(`[API] Network error for ${endpoint} (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted — throw a clear, user-friendly error
  throw new ApiError(
    'Cannot reach the server. Please check your internet connection and try again.',
    0
  );
}

export const api = {
  // ─── Authentication ──────────────────────────────────────────
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const result = await request<AuthResponse>('login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (result.token) {
        localStorage.setItem('vaultbank_token', result.token);
        localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
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
        localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
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
        localStorage.setItem('vaultbank_user', JSON.stringify(result.user));
      }
      return result;
    } catch (error) {
      throw error;
    }
  },

  logout(): void {
    localStorage.removeItem('vaultbank_token');
    localStorage.removeItem('vaultbank_user');
  },

  getToken(): string | null {
    return localStorage.getItem('vaultbank_token');
  },

  getUser(): any | null {
    const user = localStorage.getItem('vaultbank_user');
    return user ? JSON.parse(user) : null;
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('vaultbank_token');
  },

  // ─── Account & Profile ───────────────────────────────────────
  async getProfile(): Promise<ApiResponse> {
    return request<ApiResponse>('api/profile');
  },

  async getAccounts(): Promise<ApiResponse> {
    return request<ApiResponse>('api/accounts');
  },

  // ─── Transfers ───────────────────────────────────────────────
  async getTransfers(): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers');
  },

  async createTransfer(data: {
    toAccountId?: string;
    amount: number;
    currency?: string;
    description?: string;
  }): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getTransferHistory(): Promise<ApiResponse> {
    return request<ApiResponse>('api/transfers/history');
  },

  // ─── Rewards ─────────────────────────────────────────────────
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

  // ─── Alerts/Notifications ────────────────────────────────────
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

  // ─── Investments ─────────────────────────────────────────────
  async getInvestments(): Promise<ApiResponse> {
    return request<ApiResponse>('api/investments/me');
  },

  async addInvestment(data: { type: string; amount: number; description?: string }): Promise<ApiResponse> {
    return request<ApiResponse>('api/investments/add', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // ─── Payments ────────────────────────────────────────────────
  async getPaymentMethods(): Promise<ApiResponse> {
    return request<ApiResponse>('api/payments/methods');
  },

  async initiatePayment(data: {
    method: string;
    amount: number;
    currency?: string;
    to?: string;
    metadata?: any;
  }): Promise<ApiResponse> {
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

  // ─── Admin ───────────────────────────────────────────────────
  async getAdminStats(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/stats');
  },

  async getAdminUsers(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/users');
  },

  async getAdminTransactions(): Promise<ApiResponse> {
    return request<ApiResponse>('api/admin/transactions');
  },

  // ─── Health Check ────────────────────────────────────────────
  async healthCheck(): Promise<ApiResponse> {
    return request<ApiResponse>('health');
  },
};

export { ApiError };
export type { AuthResponse, ApiResponse };