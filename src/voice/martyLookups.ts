export const MARTY_LOOKUP_UNAVAILABLE = '{"status":"unavailable"}';

const ALLOWED_BASE_URL = 'https://lqqmwqrffelgnbngrkep.supabase.co';
const MAX_ARGUMENT_CHARS = 2000;

/** Look-up tools are answered by the server; everything else keeps the navigation path. */
export function isMartyLookupTool(name: string): boolean {
  return (
    typeof name === 'string' &&
    (name.startsWith('lookup_') || name === 'pairing_ideas' || name === 'my_saved_drinks')
  );
}

/**
 * Runs one Marty look-up on the server and returns the function_call_output string.
 * Never throws; every failure returns MARTY_LOOKUP_UNAVAILABLE. Never logs tokens or bodies.
 */
export async function runMartyLookup(input: {
  supabaseUrl: string;
  accessToken: string;
  tool: string;
  rawArguments: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  try {
    if (!input.accessToken || !input.accessToken.trim()) return MARTY_LOOKUP_UNAVAILABLE;
    if (input.supabaseUrl.replace(/\/+$/, '') !== ALLOWED_BASE_URL) return MARTY_LOOKUP_UNAVAILABLE;
    if (!isMartyLookupTool(input.tool)) return MARTY_LOOKUP_UNAVAILABLE;
    const raw = typeof input.rawArguments === 'string' ? input.rawArguments : '';
    if (raw.length > MAX_ARGUMENT_CHARS) return MARTY_LOOKUP_UNAVAILABLE;

    // Pass a JSON object through as an object; anything else goes as the string received.
    let args: unknown = raw;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
    } catch {
      // keep the raw string
    }

    const response = await (input.fetchImpl ?? fetch)(
      `${ALLOWED_BASE_URL}/functions/v1/discover-voice-session`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'lookup', tool: input.tool, arguments: args }),
      },
    );
    if (response.status !== 200) return MARTY_LOOKUP_UNAVAILABLE;
    const payload: unknown = await response.json();
    const output = (payload as { output?: unknown } | null)?.output;
    return typeof output === 'string' ? output : MARTY_LOOKUP_UNAVAILABLE;
  } catch {
    return MARTY_LOOKUP_UNAVAILABLE;
  }
}
