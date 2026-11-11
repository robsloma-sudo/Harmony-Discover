import { MenuExtractionResult } from '../../../../packages/shared-types/menu-extraction.js';
import type { MenuItemExtractor } from '../contracts.js';

// Conservative baseline extractor: only identifies lines that visibly resemble
// menu entries. It does not infer ingredients, producer, grape, vintage, or style.
export class LiteralLineExtractor implements MenuItemExtractor {
  async extract(input: Parameters<MenuItemExtractor['extract']>[0]) {
    const items: any[] = [];
    const pricePattern = /(?:\$\s?\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s?(?:USD|dollars?))/i;
    for (const page of input.ocr.pages) {
      for (const rawLine of page.text.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/\s+/g, ' ');
        if (line.length < 3 || line.length > 180) continue;
        const priceMatch = line.match(pricePattern);
        const nameText = priceMatch ? line.replace(priceMatch[0], '').replace(/[·•|–—-]+$/,'').trim() : line;
        if (!nameText || nameText.length < 3) continue;
        if (/^(menu|wine|beer|cocktails?|spirits?|draft|bottles?|by the glass)$/i.test(nameText)) continue;
        const looksLikeItem = Boolean(priceMatch) || /[A-Z][a-z].{2,}/.test(nameText);
        if (!looksLikeItem) continue;
        const baseConfidence = priceMatch ? 0.68 : 0.42;
        items.push({
          temporaryId: `p${page.pageNumber}-i${items.length + 1}`,
          name: { value:nameText, confidence:baseConfidence, state:'menu_observed', page:page.pageNumber, sourceText:line, method:'ocr_literal' },
          ...(priceMatch ? { price:{ value:priceMatch[0].trim(), confidence:0.78, state:'menu_observed', page:page.pageNumber, sourceText:line, method:'ocr_literal' } } : {}),
          category:{ value:'unknown', confidence:0, state:'unknown' },
          unresolvedQuestions:['Confirm beverage category','Confirm exact item identity']
        });
      }
    }
    return MenuExtractionResult.parse({
      schemaVersion:'1.0',
      observationId:input.context.observationId,
      extractionVersion:input.context.extractionVersion,
      language:'und',
      items,
      warnings:['Baseline line parser only; category and entity resolution are intentionally not inferred. Review before promotion.'],
      pagesProcessed:input.ocr.pages.length,
      provider:input.ocr.provider
    });
  }
}
