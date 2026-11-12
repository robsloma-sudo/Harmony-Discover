/** Request-body limits are measured in UTF-8 bytes, not JavaScript UTF-16 code units. */
export function isRequestBodyWithinLimit(body: string, maxBytes: number): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return false;
  return new TextEncoder().encode(body).byteLength <= maxBytes;
}
