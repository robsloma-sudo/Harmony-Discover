import { MARTY_BOSTON_CONSENT_VERSION } from './martySullivanBoston';

export type CompareLetter = 'A' | 'B' | 'C';
export type CompareGrant =
  | {
      contender: CompareLetter;
      provider: 'openai_realtime';
      ephemeralToken: string;
      expiresAt: string;
      transport: 'webrtc';
      connectHint: 'realtime' | 'live';
      voice: string;
      model?: string;
    }
  | {
      contender: CompareLetter;
      provider: 'gemini_live';
      ephemeralToken: string;
      transport: 'websocket';
      model?: string;
    };
export type CompareResult =
  | { ok: true; grant: CompareGrant }
  | { ok: false; status?: number; message: string };

const ALLOWED_BASE_URL = 'https://lqqmwqrffelgnbngrkep.supabase.co';
const LETTERS = ['A', 'B', 'C'];

function endpoint(supabaseUrl: string): string | null {
  const base = supabaseUrl.replace(/\/+$/, '');
  return base === ALLOWED_BASE_URL ? `${base}/functions/v1/discover-voice-compare` : null;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateGrant(payload: unknown): CompareGrant | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.contender !== 'string' || !LETTERS.includes(p.contender)) return null;
  if (!isNonEmptyString(p.ephemeralToken)) return null;
  if (p.model !== undefined && !isNonEmptyString(p.model)) return null;
  const contender = p.contender as CompareLetter;
  const model = typeof p.model === 'string' ? { model: p.model } : {};
  if (p.provider === 'openai_realtime') {
    if (p.transport !== 'webrtc') return null;
    if (p.connectHint !== 'realtime' && p.connectHint !== 'live') return null;
    if (!isNonEmptyString(p.expiresAt) || !isNonEmptyString(p.voice)) return null;
    return {
      contender,
      provider: 'openai_realtime',
      ephemeralToken: p.ephemeralToken,
      expiresAt: p.expiresAt,
      transport: 'webrtc',
      connectHint: p.connectHint,
      voice: p.voice,
      ...model,
    };
  }
  if (p.provider === 'gemini_live') {
    if (p.transport !== 'websocket') return null;
    return {
      contender,
      provider: 'gemini_live',
      ephemeralToken: p.ephemeralToken,
      transport: 'websocket',
      ...model,
    };
  }
  return null;
}

/** Visibility probe: an allowed user gets 400 for the empty body; everyone else is hidden. */
export async function probeListeningTest(input: {
  supabaseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const url = endpoint(input.supabaseUrl);
  if (!url || !input.accessToken || !input.accessToken.trim()) return false;
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    return response.status === 400;
  } catch {
    return false;
  }
}

export async function requestCompareSession(input: {
  supabaseUrl: string;
  accessToken: string;
  contender: CompareLetter;
  mode: 'push_to_talk' | 'hands_free';
  reveal?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<CompareResult> {
  if (!input.accessToken || !input.accessToken.trim()) {
    return { ok: false, message: 'Sign in first.' };
  }
  const url = endpoint(input.supabaseUrl);
  if (!url) return { ok: false, message: 'Discover backend URL is invalid.' };

  const body: Record<string, unknown> = {
    consentVersion: MARTY_BOSTON_CONSENT_VERSION,
    contender: input.contender,
    mode: input.mode,
  };
  if (input.reveal === true) body.reveal = true;

  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 502) {
        // Include only the provider status code, never the raw provider error.
        let providerStatus: number | undefined;
        try {
          const j = (await response.json()) as { status?: unknown };
          if (typeof j?.status === 'number') providerStatus = j.status;
        } catch {
          // ignore
        }
        const suffix = providerStatus !== undefined ? ` (provider said ${providerStatus})` : '';
        return { ok: false, status, message: `The provider refused the session${suffix}.` };
      }
      const messages: Record<number, string> = {
        404: 'Not found.',
        403: 'Voice consent is not active.',
        429: 'Too many sessions. Please wait a minute.',
        503: 'This contender is not set up yet.',
      };
      return { ok: false, status, message: messages[status] ?? `Could not start (status ${status}).` };
    }

    const grant = validateGrant(await response.json());
    if (!grant) return { ok: false, message: 'The server sent an unexpected answer.' };
    return { ok: true, grant };
  } catch {
    return { ok: false, message: 'Network connection failed.' };
  }
}
