import { z } from 'zod';

export const EvidenceState = z.enum(['menu_observed','verified','inferred','unknown']);
export const BeverageCategory = z.enum(['wine','beer','cocktail','spirit','cider','sake','other','unknown']);

export const FieldEvidence = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  state: EvidenceState,
  page: z.number().int().positive(),
  sourceText: z.string().max(500).nullable(),
  method: z.enum(['ocr_literal','user_confirmed','canonical_match','research','model_inference'])
});

export const ExtractedMenuItem = z.object({
  temporaryId: z.string().min(1),
  name: FieldEvidence,
  description: FieldEvidence.optional(),
  price: FieldEvidence.optional(),
  category: z.object({
    value: BeverageCategory,
    confidence: z.number().min(0).max(1),
    state: EvidenceState
  }),
  brandOrProducer: FieldEvidence.optional(),
  grapeOrStyle: FieldEvidence.optional(),
  vintageOrExpression: FieldEvidence.optional(),
  unresolvedQuestions: z.array(z.string()).default([])
});

export const MenuExtractionResult = z.object({
  schemaVersion: z.literal('1.0'),
  observationId: z.string().uuid(),
  extractionVersion: z.string(),
  language: z.string().default('und'),
  items: z.array(ExtractedMenuItem),
  warnings: z.array(z.string()).default([]),
  pagesProcessed: z.number().int().nonnegative(),
  provider: z.string()
});

export type MenuExtractionResultType = z.infer<typeof MenuExtractionResult>;
