export const HARMONY_MENU_FORMATS = ['html', 'pdf', 'image', 'other'] as const;
export const HARMONY_EXTRACTION_CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;
export const HARMONY_SECTION_TYPES = [
  'cocktails', 'spirits', 'wine', 'beer', 'food', 'other', 'unsectioned',
] as const;
export const HARMONY_ITEM_TYPES = [
  'cocktail', 'spirit_pour', 'flight', 'bottle', 'shot', 'other', 'unknown',
] as const;
export const HARMONY_SPIRIT_CATEGORIES = [
  'tequila', 'mezcal', 'agave_other', 'vodka', 'gin', 'rum', 'whiskey',
  'brandy', 'liqueur', 'wine', 'beer', 'non_alcoholic', 'other', 'unknown',
] as const;

export type HarmonyMenuFormat = typeof HARMONY_MENU_FORMATS[number];
export type HarmonyExtractionConfidence = typeof HARMONY_EXTRACTION_CONFIDENCE[number];
export type HarmonySectionType = typeof HARMONY_SECTION_TYPES[number];
export type HarmonyItemType = typeof HARMONY_ITEM_TYPES[number];
export type HarmonySpiritCategory = typeof HARMONY_SPIRIT_CATEGORIES[number];

export interface ReviewedHarmonyBrand {
  raw_brand_text?: string | null;
  spirit_category: HarmonySpiritCategory;
  expression?: string | null;
  brand_named?: boolean;
  match_confidence?: number | null;
}

export interface ReviewedHarmonyMenuItem {
  item_name: string;
  raw_text?: string | null;
  item_position: number;
  item_type: HarmonyItemType;
  price?: string | null;
  price_text?: string | null;
  currency?: string | null;
  brands?: ReviewedHarmonyBrand[];
}

export interface ReviewedHarmonyMenuSection {
  section_name: string;
  section_type: HarmonySectionType;
  section_position: number;
  items: ReviewedHarmonyMenuItem[];
}

/**
 * A deliberately explicit, reviewer-authored bridge to Harmony's existing
 * submit-menu intake. It does not infer venue identity, source authority,
 * evidence URLs, item types, prices, or brands from Discover OCR.
 */
export interface ReviewedHarmonyMenu {
  account_id: string;
  source_code: string;
  evidence_url: string;
  menu_title?: string | null;
  menu_format: HarmonyMenuFormat;
  extraction_confidence: HarmonyExtractionConfidence;
  extraction_notes?: string | null;
  published_date?: string | null;
  content_hash: string;
  sections: ReviewedHarmonyMenuSection[];
}

export type HarmonyMenuMappingResult =
  | { ok: true; payload: Record<string, unknown>; itemCount: number }
  | { ok: false; errors: string[] };

const BLOCKED_EVIDENCE_HOSTS = /firecrawl|webcache|googleusercontent|r\.jina\.ai|proxy/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export function mapReviewedMenuToHarmonySubmitPayload(
  input: ReviewedHarmonyMenu,
): HarmonyMenuMappingResult {
  const errors: string[] = [];

  if (!input.account_id.trim()) errors.push('account_id is required');
  if (!input.source_code.trim()) errors.push('source_code is required and must resolve to a registered Harmony source');
  try {
    const url = new URL(input.evidence_url);
    if (url.protocol !== 'https:') errors.push('evidence_url must use HTTPS');
    if (BLOCKED_EVIDENCE_HOSTS.test(url.hostname) || BLOCKED_EVIDENCE_HOSTS.test(input.evidence_url)) {
      errors.push('evidence_url must be a publisher-owned URL, not a scraper or cache');
    }
  } catch {
    errors.push('evidence_url must be a valid publisher-owned HTTPS URL');
  }

  if (!HARMONY_MENU_FORMATS.includes(input.menu_format)) errors.push('menu_format is invalid');
  if (!HARMONY_EXTRACTION_CONFIDENCE.includes(input.extraction_confidence)) errors.push('extraction_confidence is invalid');
  if (!SHA256.test(input.content_hash)) errors.push('content_hash must be a SHA-256 hex digest');
  if (input.published_date && !ISO_DATE.test(input.published_date)) errors.push('published_date must be YYYY-MM-DD');
  if (!Array.isArray(input.sections)) errors.push('sections must be an array');

  let itemCount = 0;
  const sections = (Array.isArray(input.sections) ? input.sections : []).map((section, sectionIndex) => {
    if (!section.section_name.trim()) errors.push(`sections[${sectionIndex}].section_name is required`);
    if (!HARMONY_SECTION_TYPES.includes(section.section_type)) {
      errors.push(`sections[${sectionIndex}].section_type is invalid`);
    }
    if (!Number.isInteger(section.section_position) || section.section_position < 0) {
      errors.push(`sections[${sectionIndex}].section_position must be a non-negative integer`);
    }
    if (!Array.isArray(section.items)) {
      errors.push(`sections[${sectionIndex}].items must be an array`);
      return { ...section, items: [] };
    }

    const items = section.items.map((item, itemIndex) => {
      itemCount += 1;
      const path = `sections[${sectionIndex}].items[${itemIndex}]`;
      if (!item.item_name.trim()) errors.push(`${path}.item_name is required`);
      if (!HARMONY_ITEM_TYPES.includes(item.item_type)) errors.push(`${path}.item_type is invalid`);
      if (!Number.isInteger(item.item_position) || item.item_position < 0) {
        errors.push(`${path}.item_position must be a non-negative integer`);
      }
      if (item.price != null && item.price !== '') {
        if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(item.price)) {
          errors.push(`${path}.price must be a non-negative decimal with at most two fractional digits`);
        }
      }
      if (item.currency != null && !CURRENCY.test(item.currency)) {
        errors.push(`${path}.currency must be a three-letter uppercase code`);
      }
      for (const [brandIndex, brand] of (item.brands ?? []).entries()) {
        if (!HARMONY_SPIRIT_CATEGORIES.includes(brand.spirit_category)) {
          errors.push(`${path}.brands[${brandIndex}].spirit_category is invalid`);
        }
        if (brand.match_confidence != null &&
          (!Number.isFinite(brand.match_confidence) || brand.match_confidence < 0 || brand.match_confidence > 1)) {
          errors.push(`${path}.brands[${brandIndex}].match_confidence must be between 0 and 1`);
        }
      }
      return {
        item_name: item.item_name.trim(),
        raw_text: item.raw_text ?? null,
        item_position: item.item_position,
        item_type: item.item_type,
        price: item.price ?? null,
        price_text: item.price_text ?? null,
        currency: item.currency ?? null,
        brands: (item.brands ?? []).map((brand) => ({
          raw_brand_text: brand.raw_brand_text ?? null,
          spirit_category: brand.spirit_category,
          expression: brand.expression ?? null,
          brand_named: brand.brand_named ?? Boolean(brand.raw_brand_text),
          match_confidence: brand.match_confidence ?? null,
        })),
      };
    });

    return {
      section_name: section.section_name.trim(),
      section_type: section.section_type,
      section_position: section.section_position,
      items,
    };
  });

  if (itemCount === 0 && (input.menu_format === 'pdf' || input.menu_format === 'image')) {
    errors.push('PDF/image menu promotion requires at least one positively verified item');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    itemCount,
    payload: {
      account_id: input.account_id.trim(),
      source_code: input.source_code.trim(),
      evidence_url: input.evidence_url,
      menu_title: input.menu_title ?? null,
      menu_format: input.menu_format,
      extraction_confidence: input.extraction_confidence,
      extraction_notes: input.extraction_notes ?? null,
      published_date: input.published_date ?? null,
      content_hash: input.content_hash.toLowerCase(),
      sections,
    },
  };
}
