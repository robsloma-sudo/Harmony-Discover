import type { BottleIntelligenceProfile, BottleRead } from '../services/discoverLiveApi';
import { getBottleIntelligenceSections } from '../services/bottleIntelligenceSchema';

const asText = (value: unknown): string => Array.isArray(value) ? value.map(String).join(', ') : typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** Another name a fact may be stored under (label reads and research use different keys). */
const ALIASES: Record<string, string[]> = {
  producer: ['producer', 'winery', 'distillery', 'estate', 'brand_owner'],
  size: ['size', 'net_contents', 'package_size'],
  proof: ['proof', 'alcohol_statement'],
  country: ['country', 'origin'],
  distillery: ['distillery', 'producer'],
  estate: ['estate', 'winery'],
  classification: ['classification', 'subcategory'],
  vintage: ['vintage', 'harvested_on'],
  distillation_method: ['distillation_method', 'distillation'],
  agave_origin: ['agave_origin', 'state_or_province'],
  scotch_region: ['scotch_region', 'region'],
  jurisdiction: ['jurisdiction', 'state_or_province'],
  style: ['style', 'subcategory'],
  production_method: ['production_method'],
  rose_method: ['rose_method', 'production_method'],
  sparkling_method: ['sparkling_method', 'production_method'],
  bottling_strength: ['bottling_strength', 'alcohol_statement'],
  base_spirit: ['base_spirit', 'grain'],
  base_material: ['base_material', 'grain'],
  ingredients: ['ingredients', 'flavor'],
};

/** Every value the card can show, from the label read and the shared product record. */
export function profileFieldValues(bottle: BottleRead, intelligence: BottleIntelligenceProfile | null): Record<string, string> {
  const details = (bottle.details || {}) as Record<string, unknown>;
  const raw: Record<string, string> = {};
  const put = (key: string, value: unknown) => { const v = asText(value).trim(); if (v && !raw[key]) raw[key] = v; };
  put('brand', bottle.match?.brand || bottle.brand);
  put('product', bottle.match?.product || bottle.product);
  put('size', bottle.size); put('proof', bottle.proof); put('origin', bottle.origin);
  put('label_text', bottle.words?.join(' · '));
  for (const [key, value] of Object.entries(details)) put(key, value);
  for (const attribute of intelligence?.attributes ?? []) {
    put(attribute.attribute_code, attribute.value_text ?? (attribute.value_numeric !== null ? String(attribute.value_numeric) + (attribute.unit ? ' ' + attribute.unit : '') : attribute.value_json));
  }
  for (const pkg of intelligence?.packages ?? []) {
    if (pkg.package_size_ml) put('size', String(pkg.package_size_ml) + ' mL');
    if (pkg.abv_percent) put('proof', String(pkg.abv_percent) + '% ABV');
  }
  const out: Record<string, string> = { ...raw };
  for (const [key, names] of Object.entries(ALIASES)) {
    if (out[key]) continue;
    const hit = names.map(name => raw[name]).find(Boolean);
    if (hit) out[key] = hit;
  }
  return out;
}

const TASTING = new Set(['tasting_notes', 'nose', 'palate', 'finish', 'food_pairing']);

/** The card's empty categories (key + label), for background research. */
export function missingProfileFields(bottle: BottleRead, intelligence: BottleIntelligenceProfile | null): Array<{ key: string; label: string }> {
  const values = profileFieldValues(bottle, intelligence);
  return getBottleIntelligenceSections(bottle.category, (bottle.details || {}) as Record<string, unknown>)
    .flatMap(section => section.fields)
    .filter(item => !values[item.key] && !['brand', 'product', 'label_text'].includes(item.key))
    .map(item => ({ key: item.key, label: item.label }))
    // Tasting notes are researched first for every drink.
    .sort((a, b) => Number(!TASTING.has(a.key)) - Number(!TASTING.has(b.key)));
}
