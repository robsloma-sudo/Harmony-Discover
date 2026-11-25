// 21+ age check in front of Marty (P-20261125-2244 part 2). Pure: no Deno globals, no database.
// The app shows a one-time "are you 21 or older?" screen and sends age_confirmed: true with every voice start.
// The server refuses to start any paid voice session (Marty or the listening test) without it.
// MARTY_AGE_CHECK=off (any case) is the server-wide stop switch that lets sessions start without the field.

export const AGE_CHECK_FIELD = "age_confirmed";
export const AGE_CHECK_STATUS = 403;
export const AGE_CHECK_ERROR = {
  error: "Age check needed. Please confirm you are 21 or older to talk to Marty.",
  code: "age_check_needed",
} as const;

// The field is optional in shape (so the request stays valid) but must be a real boolean when present.
export function validAgeField(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

export function ageCheckRequired(env: string | undefined | null): boolean {
  return (env ?? "").trim().toLowerCase() !== "off";
}

// null = go ahead; otherwise the calm error to send back. Only exactly true passes.
export function ageGate(ageConfirmed: unknown, env: string | undefined | null):
  { status: number; body: typeof AGE_CHECK_ERROR } | null {
  if (!ageCheckRequired(env)) return null;
  if (ageConfirmed === true) return null;
  return { status: AGE_CHECK_STATUS, body: AGE_CHECK_ERROR };
}
