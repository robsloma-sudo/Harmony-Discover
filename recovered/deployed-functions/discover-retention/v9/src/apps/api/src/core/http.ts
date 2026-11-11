// GENERATED from apps/api/src/core/http.ts by scripts/build-edge.mjs. Do not edit; deploy to the Discover DEV project only.
// Framework-neutral request results. Fastify (local) and Supabase Edge Functions (deployed) both adapt these.
export interface Result { status: number; body: unknown; headers?: Record<string, string> }
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
  get statusCode() { return this.status; }   // Fastify reads statusCode
}
export const ok = (body: unknown, status = 200, headers?: Record<string, string>): Result => ({ status, body, headers });
/** Async so the limit can live in the database (Edge Functions are stateless). */
export interface SubjectLimiter { allow(subjectId: string): Promise<boolean> | boolean }
export type Identify = (authorizationHeader: string | undefined) => Promise<string>;

/** Fixed-window per-subject limiter in memory: for tests and a single local process only. */
export function memoryLimiter(max: number, windowMs: number, now: () => number = Date.now): SubjectLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(subjectId) {
      const t = now(); const w = windows.get(subjectId);
      if (!w || t - w.start >= windowMs) { windows.set(subjectId, { start: t, count: 1 }); return true; }
      w.count += 1; return w.count <= max;
    },
  };
}
