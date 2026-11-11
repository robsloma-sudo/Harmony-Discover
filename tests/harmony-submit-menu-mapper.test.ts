import { describe, expect, it } from 'vitest';
import { mapReviewedMenuToHarmonySubmitPayload, type ReviewedHarmonyMenu } from '../src/integration/harmonySubmitMenuMapper';

const valid: ReviewedHarmonyMenu = {
  account_id: 'account-key-123',
  source_code: 'TRUSTED-PUBLISHER',
  evidence_url: 'https://venue.example.com/menu',
  menu_title: 'Cocktail Menu',
  menu_format: 'html',
  extraction_confidence: 'high',
  content_hash: 'a'.repeat(64),
  sections: [{
    section_name: 'Cocktails',
    section_type: 'cocktails',
    section_position: 0,
    items: [{
      item_name: 'House Margarita',
      raw_text: 'House Margarita — blanco tequila, lime',
      item_position: 0,
      item_type: 'cocktail',
      price: '14.00',
      price_text: '$14',
      currency: 'USD',
      brands: [{ raw_brand_text: 'Example Tequila', spirit_category: 'tequila', brand_named: true, match_confidence: 0.95 }],
    }],
  }],
};

describe('reviewed Discover → Harmony menu mapper', () => {
  it('maps a fully reviewed menu to the existing submit-menu payload', () => {
    const result = mapReviewedMenuToHarmonySubmitPayload(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.itemCount).toBe(1);
    expect(result.payload).toMatchObject({
      account_id: 'account-key-123',
      source_code: 'TRUSTED-PUBLISHER',
      evidence_url: 'https://venue.example.com/menu',
      menu_format: 'html',
      extraction_confidence: 'high',
    });
  });

  it('refuses private, temporary, scraper, and non-HTTPS evidence URLs', () => {
    for (const evidence_url of [
      'http://venue.example.com/menu',
      'https://firecrawl.example/menu',
      'https://venue.example.com/proxy/menu',
    ]) {
      const result = mapReviewedMenuToHarmonySubmitPayload({ ...valid, evidence_url });
      expect(result.ok).toBe(false);
    }
  });

  it('refuses image/PDF captures with no positively verified items', () => {
    for (const menu_format of ['image', 'pdf'] as const) {
      const result = mapReviewedMenuToHarmonySubmitPayload({ ...valid, menu_format, sections: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toContain('at least one');
    }
  });

  it('refuses invalid price, currency, item type, and brand category', () => {
    const result = mapReviewedMenuToHarmonySubmitPayload({
      ...valid,
      sections: [{
        ...valid.sections[0],
        items: [{
          ...valid.sections[0].items[0],
          price: '-14',
          currency: 'US',
          item_type: 'spirits' as never,
          brands: [{ spirit_category: 'agave' as never, match_confidence: 1.2 }],
        }],
      }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('price'))).toBe(true);
      expect(result.errors.some((error) => error.includes('currency'))).toBe(true);
      expect(result.errors.some((error) => error.includes('item_type'))).toBe(true);
      expect(result.errors.some((error) => error.includes('spirit_category'))).toBe(true);
    }
  });

  it('does not invent a numeric price when only price text is present', () => {
    const result = mapReviewedMenuToHarmonySubmitPayload({
      ...valid,
      sections: [{
        ...valid.sections[0],
        items: [{ ...valid.sections[0].items[0], price: null, price_text: 'Market Price' }],
      }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sections = result.payload.sections as Array<{ items: Array<{ price: string | null; price_text: string }> }>;
      expect(sections[0].items[0].price).toBeNull();
      expect(sections[0].items[0].price_text).toBe('Market Price');
    }
  });
});
