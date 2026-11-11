import type { OcrPage, OcrProvider } from '../contracts.js';

// Vendor-neutral HTTP adapter. Configure only against a provider endpoint you have
// reviewed for privacy, retention, regional processing, and contractual terms.
export class HttpOcrProvider implements OcrProvider {
  readonly name = 'configured-http-ocr';
  constructor(private endpoint: string, private apiKey: string) {}

  async recognize(input: { imageBytes: Buffer; mimeType: string; pageNumber: number }): Promise<OcrPage> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': input.mimeType,
        'x-page-number': String(input.pageNumber)
      },
      body: new Uint8Array(input.imageBytes)
    });
    if (!response.ok) throw new Error(`OCR provider returned HTTP ${response.status}`);
    const body = await response.json() as { text?: string; confidence?: number; request_id?: string };
    if (typeof body.text !== 'string') throw new Error('OCR provider response missing text');
    return { pageNumber: input.pageNumber, text: body.text, provider: this.name, confidence: body.confidence };
  }
}

export function configuredOcrProvider(): OcrProvider {
  const endpoint = process.env.OCR_PROVIDER_URL;
  const apiKey = process.env.OCR_PROVIDER_API_KEY;
  if (!endpoint || !apiKey) throw new Error('OCR provider is not configured');
  return new HttpOcrProvider(endpoint, apiKey);
}
