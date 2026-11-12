import { describe, expect, it, vi } from 'vitest';
import { handle, type EdgeDeps } from '../apps/edge/router.ts';

function deps(overrides: Partial<EdgeDeps> = {}): EdgeDeps {
  return {
    identify: vi.fn(async () => 'discover-anon-user'),
    learning: { store: {} as never, limiter: { allow: () => true } },
    account: { store: {} as never, removeObjects: async () => {}, deleteAuthUser: async () => {}, limiter: { allow: () => true } },
    observations: null,
    atlas: null,
    readMenu: async () => ({ status: 501, body: {} }),
    allowedOrigins: new Set(),
    ...overrides,
  };
}

function request(query: string) {
  return new Request('https://discover.example/functions/v1/discover-api/v1/atlas/venues' + query, {
    method: 'GET', headers: { authorization: 'Bearer valid-discover-session' },
  });
}

describe('Discover Atlas API boundary', () => {
  it('fails closed with a specific error until the PHG bridge is configured', async () => {
    const response = await handle(request('?latitude=41.25&longitude=-95.93&radius_miles=5'), deps());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'atlas_bridge_not_configured' });
  });

  it('rejects coordinates outside geographic bounds', async () => {
    const query = vi.fn(async () => ({ status: 200, body: { venues: [] } }));
    const response = await handle(request('?latitude=91&longitude=-95.93&radius_miles=5'), deps({ atlas: { limiter: { allow: () => true }, query } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_coordinates' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects arbitrary radii and venue types before calling the bridge', async () => {
    const query = vi.fn(async () => ({ status: 200, body: { venues: [] } }));
    const atlas = { limiter: { allow: () => true }, query };
    const radius = await handle(request('?latitude=41.25&longitude=-95.93&radius_miles=500'), deps({ atlas }));
    expect(radius.status).toBe(400);
    const type = await handle(request('?latitude=41.25&longitude=-95.93&radius_miles=5&venue_type=anything'), deps({ atlas }));
    expect(type.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('uses authenticated subject rate limiting before querying', async () => {
    const query = vi.fn(async () => ({ status: 200, body: { venues: [] } }));
    const response = await handle(request('?latitude=41.25&longitude=-95.93&radius_miles=5'), deps({ atlas: { limiter: { allow: () => false }, query } }));
    expect(response.status).toBe(429);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes only validated search dimensions to the configured bridge', async () => {
    const query = vi.fn(async () => ({ status: 200, body: { venues: [] } }));
    const response = await handle(request('?latitude=41.25&longitude=-95.93&radius_miles=10&venue_type=brewery&rpc=phg_atlas_points'), deps({ atlas: { limiter: { allow: () => true }, query } }));
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledWith(41.25, -95.93, 10, 'brewery');
  });
});
