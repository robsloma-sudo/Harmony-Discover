// Option B (live photo-real video face) client for the hidden listening test. Pure fetch, no React Native imports.
import type { VoicePick } from './logic';

/*
 * ============================================================================================================
 * TODO(P-20261126-0028 backend contract): match function name, request body keys and video stream fields once
 * the Discover backend PR names them. The backend has NOT named the server program or its fields yet.
 *   - FACE_B_FUNCTION below is a placeholder name.
 *   - The request body { ageConfirmed, voice } is a guess.
 *   - The response fields read below (streamUrl / stream_url / videoUrl, sdp / answerSdp) are guesses.
 * ============================================================================================================
 */
export const FACE_B_FUNCTION = 'discover-face-live';

export const FACE_B_NOT_BUILT = 'Option B is not switched on yet. The server team is still building it.';
export const FACE_B_KEY_MISSING = "Face service key not set. Option B can't start until it is added.";
export const FACE_B_UNREACHABLE = 'Option B could not be reached.';

export type FaceBResult =
  | { ok: true; streamUrl?: string; sdp?: string; raw: unknown }
  | { ok: false; status?: number; message: string; keyMissing?: boolean; notBuilt?: boolean };

const KEY_MISSING_RE = /face[ _-]?service.*key.*not set|FACE_.*KEY.*(missing|not set)/i;

export function isFaceKeyMissing(text: unknown): boolean {
  return typeof text === 'string' && (KEY_MISSING_RE.test(text) || /face_key_missing/i.test(text));
}

export async function requestFaceB(opts: { supabaseUrl: string; accessToken: string; ageConfirmed: boolean; voice: VoicePick }): Promise<FaceBResult> {
  const { supabaseUrl, accessToken, ageConfirmed, voice } = opts;
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/${FACE_B_FUNCTION}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ageConfirmed, voice }),
    });
  } catch {
    return { ok: false, message: FACE_B_UNREACHABLE };
  }
  const status = response.status;
  if (status === 404) return { ok: false, status, message: FACE_B_NOT_BUILT, notBuilt: true };
  if (!response.ok) {
    let errText = '';
    try {
      errText = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    } catch {
      try { errText = JSON.stringify(await response.json()); } catch { errText = ''; }
    }
    if (isFaceKeyMissing(errText)) return { ok: false, status, message: FACE_B_KEY_MISSING, keyMissing: true };
    return { ok: false, status, message: `Option B could not start (error ${status}).` };
  }
  let raw: unknown = null;
  try { raw = await response.json(); } catch { raw = null; }
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => { for (const k of keys) if (typeof d[k] === 'string' && d[k]) return d[k] as string; return undefined; };
  return { ok: true, streamUrl: pick('streamUrl', 'stream_url', 'videoUrl', 'video_url'), sdp: pick('sdp', 'answerSdp', 'answer_sdp'), raw };
}
