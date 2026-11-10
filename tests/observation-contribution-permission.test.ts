import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getObservationContribution,
  grantObservationContribution,
  withdrawObservationContribution,
} from '../apps/api/src/core/observations';

const OBSERVATION_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT_ID = '22222222-2222-4222-8222-222222222222';

function ownedObservationDb(status = 'ready_for_review', activeGrant: unknown = null) {
  const maybeSingle = vi.fn()
    .mockResolvedValueOnce({ data: { id: OBSERVATION_ID, status }, error: null })
    .mockResolvedValueOnce({ data: activeGrant, error: null });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle,
  };
  const db = {
    from: vi.fn(() => chain),
    rpc: vi.fn(),
  };
  return { db: db as unknown as SupabaseClient, raw: db, maybeSingle };
}

describe('observation-specific Harmony contribution permission', () => {
  it('reports no active grant for an owned observation', async () => {
    const { db } = ownedObservationDb();
    const result = await getObservationContribution(db, SUBJECT_ID, OBSERVATION_ID);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ granted: false, policyVersion: null, grantedAt: null });
  });

  it('refuses an unsupported or missing policy version', async () => {
    const { db, raw } = ownedObservationDb();
    const result = await grantObservationContribution(db, SUBJECT_ID, OBSERVATION_ID, { policyVersion: 'other' });
    expect(result.status).toBe(400);
    expect(raw.rpc).not.toHaveBeenCalled();
  });

  it('writes a versioned grant through the owner-scoped database function', async () => {
    const { db, raw } = ownedObservationDb();
    raw.rpc.mockResolvedValue({ data: '33333333-3333-4333-8333-333333333333', error: null });
    const result = await grantObservationContribution(db, SUBJECT_ID, OBSERVATION_ID, {
      policyVersion: 'discover-harmony-contribution-v1',
    });
    expect(result.status).toBe(201);
    expect(raw.rpc).toHaveBeenCalledWith('discover_grant_observation_contribution', {
      p_subject: SUBJECT_ID,
      p_observation: OBSERVATION_ID,
      p_policy_version: 'discover-harmony-contribution-v1',
    });
  });

  it('withdraws permission through the transactional audit function', async () => {
    const { db, raw } = ownedObservationDb();
    raw.rpc.mockResolvedValue({ data: true, error: null });
    const result = await withdrawObservationContribution(db, SUBJECT_ID, OBSERVATION_ID);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ withdrawn: true, alreadyInactive: false });
    expect(raw.rpc).toHaveBeenCalledWith('discover_withdraw_observation_contribution', {
      p_subject: SUBJECT_ID,
      p_observation: OBSERVATION_ID,
    });
  });
});
