// Photo-real talking face for the Rob-only Marty listening test (P-20261126-0028 part 1, "option B").
// Pure logic, fetch injected. Service: Anam (api.anam.ai), "audio passthrough" mode: Anam draws the face only.
// It never thinks or speaks for Marty; the phone feeds it Marty's own audio (today's voice or the ElevenLabs
// "Marty" voice), and Anam returns a WebRTC video of our own original face L moving its lips, jaw, cheeks and
// eyes to that audio.
//
// The key lives only in the Edge Functions secret ANAM_API_KEY on Discover dev and never leaves the server.
// The app only gets a short-lived Anam session token.
// The face is our own original face L image, uploaded once by Rob as an Anam custom (one-shot) avatar; its id
// goes in the secret ANAM_AVATAR_ID. No stock avatar and no real person's face is ever used: without
// ANAM_AVATAR_ID the server refuses instead of falling back to any built-in avatar.
//
// Confirmed from Anam docs (custom-TTS / audio passthrough page, read 26 Nov 2026):
//   POST https://api.anam.ai/v1/auth/session-token, header "Authorization: Bearer <key>",
//   body { personaConfig: { avatarId, avatarModel: "cara-4", enableAudioPassthrough: true } },
//   answer { sessionToken }. Do NOT send a personaId (that switches on Anam's own brain).
//   App side: createClient(sessionToken, { disableInputAudio: true }), streamToVideoElement(<video id>),
//   createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: 16000, channels: 1 }), sendAudioChunk(...),
//   endSequence() at the end of each Marty turn, interruptPersona() on Stop / barge-in.
// UNCONFIRMED: newer avatar model names ("cara-4.1-express" appears in Anam's changelog). Override with the
// ANAM_AVATAR_MODEL secret; the default is the docs' "cara-4". A refusal reports only step and status.

export const ANAM_API = "https://api.anam.ai";
export const ANAM_SESSION_TOKEN_URL = `${ANAM_API}/v1/auth/session-token`;
export const FACE_PROVIDER = "anam";
export const FACE_KEY_MISSING = "face service key not set";
export const FACE_AVATAR_MISSING = "face not set up";
export const DEFAULT_AVATAR_MODEL = "cara-4";

// What the phone must send into the face service (exact values the app reads from the answer).
export const FACE_AUDIO_INPUT = { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 } as const;

// Request field: face (optional). "phone" (default) = today's face L animated on the phone (option A).
// "photo" = also start the photo-real face service (option B).
export type FacePick = "phone" | "photo";
export const FACE_PICKS: readonly string[] = ["phone", "photo"];

export interface FaceEnv { apiKey?: string; avatarId?: string; avatarModel?: string }
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type FaceResult = { ok: true; sessionToken: string } | { ok: false; step: string; status: number };

// Checked before consent, rate limit and any paid call. Returns the refusal, or null when ready.
export function faceNotReady(face: FacePick | undefined, env: FaceEnv): { status: number; body: { error: string } } | null {
  if (face !== "photo") return null;
  if (!(env.apiKey ?? "").trim()) return { status: 503, body: { error: FACE_KEY_MISSING } };
  if (!(env.avatarId ?? "").trim()) return { status: 503, body: { error: FACE_AVATAR_MISSING } };
  return null;
}

export function buildFaceSessionBody(avatarId: string, avatarModel?: string) {
  return {
    personaConfig: {
      avatarId,
      avatarModel: (avatarModel ?? "").trim() || DEFAULT_AVATAR_MODEL,
      enableAudioPassthrough: true,
    },
  };
}

// Never returns, logs or forwards a provider body or key: only the failing step name and status code.
export async function mintFace(env: FaceEnv, fetchImpl: FetchLike = fetch): Promise<FaceResult> {
  const key = (env.apiKey ?? "").trim();
  const avatarId = (env.avatarId ?? "").trim();
  if (!key || !avatarId) return { ok: false, step: "face_config", status: 0 };
  let res: Response;
  try {
    res = await fetchImpl(ANAM_SESSION_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildFaceSessionBody(avatarId, env.avatarModel)),
    });
  } catch {
    return { ok: false, step: "face_token", status: 0 };
  }
  let payload: { sessionToken?: unknown } = {};
  try { payload = await res.json(); } catch { /* handled below */ }
  const token = typeof payload?.sessionToken === "string" ? payload.sessionToken : "";
  if (!res.ok || !token) return { ok: false, step: "face_token", status: res.ok ? 200 : res.status };
  return { ok: true, sessionToken: token };
}
