import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, getApiTimingStats, resetApiTimingStats, apiRouteKey } from '../api';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('API retry policy', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetApiTimingStats();
    localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('never retries a non-idempotent money POST', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.accountDeposit({ amount: 10 })).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a safe GET once and succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('reset'))
      .mockResolvedValueOnce(jsonResponse({ success: true, user: { id: 'u1' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = api.getProfile();
    await vi.advanceTimersByTimeAsync(1300);
    const result = await pending;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a POST only when the caller supplied an Idempotency-Key', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('reset'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = api.sendMoney({ recipientEmail: 'a@b.com', amount: 5 }, 'idem-key-1');
    await vi.advanceTimersByTimeAsync(1300);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    const sentKey = headers['Idempotency-Key'] ?? headers['idempotency-key'];
    expect(sentKey).toBe('idem-key-1');
  });

  it('de-duplicates concurrent GETs', async () => {
    let resolveFetch!: (value: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = api.getProfile();
    const second = api.getProfile();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ success: true }));
    await Promise.all([first, second]);
  });

  it('keeps query strings out of timing metric keys', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ success: true, users: [] })) as unknown as typeof fetch;

    await api.searchUsers('alice@example.com');
    const stats = getApiTimingStats();

    expect(stats[0].key).toBe('GET /api/account/users/search');
    expect(JSON.stringify(stats)).not.toContain('alice');
  });
});

describe('apiRouteKey', () => {
  it('collapses UUIDs and numeric identifiers', () => {
    expect(apiRouteKey('api/issuing/cards/123/transactions', 'get'))
      .toBe('GET /api/issuing/cards/:id/transactions');
    expect(apiRouteKey('api/kyc/550e8400-e29b-41d4-a716-446655440000/approve', 'PUT'))
      .toBe('PUT /api/kyc/:id/approve');
  });
});
