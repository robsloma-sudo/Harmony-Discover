export type OcrPage = {
  pageNumber: number;
  text: string;
  provider: string;
  confidence?: number;
};

export type OcrDocument = {
  pages: OcrPage[];
  provider: string;
  providerRequestId?: string;
};

export interface OcrProvider {
  readonly name: string;
  recognize(input: { imageBytes: Buffer; mimeType: string; pageNumber: number }): Promise<OcrPage>;
}

export type ExtractionContext = {
  observationId: string;
  extractionVersion: string;
};

export interface MenuItemExtractor {
  extract(input: { context: ExtractionContext; ocr: OcrDocument }): Promise<unknown>;
}
