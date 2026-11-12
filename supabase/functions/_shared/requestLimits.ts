/** Request-body limits are measured in UTF-8 bytes, not JavaScript UTF-16 code units. */
export async function readUtf8RequestBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<{ body: string; tooLarge: boolean }> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return { body: "", tooLarge: true };
  const reader = request.body?.getReader();
  if (!reader) return { body: "", tooLarge: false };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { body: "", tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), tooLarge: false };
}
