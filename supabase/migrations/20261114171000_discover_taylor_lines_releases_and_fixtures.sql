-- Harmony Discover DEV: label dictionary seed, E.H. Taylor lines / barcodes / releases, test bottles.
-- Every release row carries the URLs it came from; barcodes and lot codes marked observed_label
-- were read from Rob's own bottles (photos in #phg-ops, 2026-11-14). PHG production is untouched.

-- 1) Label phrases. Codes point at PHG attribute values / categories (checked by
--    discover_label_dictionary_problems()).
insert into public.discover_label_terms(term, role, maps_to, source, priority, note) values
  ('barrel proof',        'attribute', '{"dimension":"strength","value":"cask_strength"}', 'discover_seed', 60, null),
  ('barrel strength',     'attribute', '{"dimension":"strength","value":"cask_strength"}', 'discover_seed', 60, null),
  ('cask strength',       'attribute', '{"dimension":"strength","value":"cask_strength"}', 'discover_seed', 60, null),
  ('uncut',               'attribute', '{"dimension":"strength","value":"cask_strength"}', 'discover_seed', 40, 'uncut = not diluted'),
  ('bottled in bond',     'attribute', '{"dimension":"strength","value":"bottled_in_bond"}', 'discover_seed', 60, null),
  ('bonded',              'attribute', '{"dimension":"strength","value":"bottled_in_bond"}', 'discover_seed', 40, null),
  ('single barrel',       'attribute', '{"dimension":"expression","value":"single_cask"}', 'discover_seed', 60, null),
  ('single cask',         'attribute', '{"dimension":"expression","value":"single_cask"}', 'discover_seed', 60, null),
  ('small batch',         'attribute', '{"dimension":"expression","value":"small_batch"}', 'discover_seed', 60, null),
  ('limited release',     'attribute', '{"dimension":"expression","value":"limited_release"}', 'discover_seed', 60, null),
  ('limited edition',     'attribute', '{"dimension":"expression","value":"limited_release"}', 'discover_seed', 60, null),
  ('non chill filtered',  'attribute', '{"dimension":"expression","value":"non_chill_filtered"}', 'discover_seed', 60, null),
  ('unchillfiltered',     'attribute', '{"dimension":"expression","value":"non_chill_filtered"}', 'discover_seed', 60, null),
  ('peated',              'attribute', '{"dimension":"peat","value":"peated"}', 'discover_seed', 60, null),
  -- US class / type statements: these name the category, never the product.
  ('kentucky straight bourbon whiskey', 'category', '{"phg_category_id":"56018386-e4ba-087b-ba0a-f18a3f0db876","legal_class":true}', 'discover_seed', 70, null),
  ('kentucky straight bourbon whisky',  'category', '{"phg_category_id":"56018386-e4ba-087b-ba0a-f18a3f0db876","legal_class":true}', 'discover_seed', 70, null),
  ('straight bourbon whiskey',          'category', '{"phg_category_id":"56018386-e4ba-087b-ba0a-f18a3f0db876","legal_class":true}', 'discover_seed', 70, null),
  ('straight bourbon whisky',           'category', '{"phg_category_id":"56018386-e4ba-087b-ba0a-f18a3f0db876","legal_class":true}', 'discover_seed', 70, null),
  ('bourbon whiskey',                   'category', '{"phg_category_id":"5dfad9ab-e070-4d7b-4b1b-ebc8a1b208d6","legal_class":true}', 'discover_seed', 70, null),
  ('bourbon whisky',                    'category', '{"phg_category_id":"5dfad9ab-e070-4d7b-4b1b-ebc8a1b208d6","legal_class":true}', 'discover_seed', 70, null),
  ('kentucky straight rye whiskey',     'category', '{"phg_category_id":"5f0d7699-e8b9-1f88-249c-8d03e1632fc6","legal_class":true}', 'discover_seed', 70, null),
  ('kentucky straight rye whisky',      'category', '{"phg_category_id":"5f0d7699-e8b9-1f88-249c-8d03e1632fc6","legal_class":true}', 'discover_seed', 70, null),
  ('straight rye whiskey',              'category', '{"phg_category_id":"5f0d7699-e8b9-1f88-249c-8d03e1632fc6","legal_class":true}', 'discover_seed', 70, null),
  ('straight rye whisky',               'category', '{"phg_category_id":"5f0d7699-e8b9-1f88-249c-8d03e1632fc6","legal_class":true}', 'discover_seed', 70, null),
  ('tennessee whiskey',                 'category', '{"phg_category_id":"d7083d08-32b0-db4f-c89d-d3fa0bbef596","legal_class":true}', 'discover_seed', 70, null),
  ('tennessee whisky',                  'category', '{"phg_category_id":"d7083d08-32b0-db4f-c89d-d3fa0bbef596","legal_class":true}', 'discover_seed', 70, null),
  ('corn whiskey',                      'category', '{"phg_category_id":"14a8867f-7824-dd27-cafc-6fe604e3ac1c","legal_class":true}', 'discover_seed', 70, null),
  ('straight wheat whiskey',            'category', '{"phg_category_id":"bb01b71d-8428-92d2-e95f-914588ae16f5","legal_class":true}', 'discover_seed', 70, null),
  -- Who made it: the words after these are the producer's name.
  ('distilled aged and bottled by', 'producer_phrase', '{}', 'discover_seed', 60, null),
  ('distilled and bottled by',      'producer_phrase', '{}', 'discover_seed', 60, null),
  ('aged and bottled by',           'producer_phrase', '{}', 'discover_seed', 60, null),
  ('produced and bottled by',       'producer_phrase', '{}', 'discover_seed', 60, null),
  ('blended and bottled by',        'producer_phrase', '{}', 'discover_seed', 60, null),
  ('bottled by',                    'producer_phrase', '{}', 'discover_seed', 60, null),
  ('distilled by',                  'producer_phrase', '{}', 'discover_seed', 60, null),
  ('produced by',                   'producer_phrase', '{}', 'discover_seed', 60, null),
  ('imported by',                   'producer_phrase', '{}', 'discover_seed', 60, null),
  -- Places (stop the producer name; never part of the product name).
  ('frankfort', 'place', '{}', 'discover_seed', 30, null), ('kentucky', 'place', '{}', 'discover_seed', 30, null),
  ('ky', 'place', '{}', 'discover_seed', 30, null), ('louisville', 'place', '{}', 'discover_seed', 30, null),
  ('bardstown', 'place', '{}', 'discover_seed', 30, null), ('lawrenceburg', 'place', '{}', 'discover_seed', 30, null),
  ('loretto', 'place', '{}', 'discover_seed', 30, null), ('clermont', 'place', '{}', 'discover_seed', 30, null),
  ('lynchburg', 'place', '{}', 'discover_seed', 30, null), ('tennessee', 'place', '{}', 'discover_seed', 30, null),
  ('tn', 'place', '{}', 'discover_seed', 30, null),
  -- Deposit / legal text.
  ('ca crv', 'regulatory', '{}', 'discover_seed', 30, null), ('crv', 'regulatory', '{}', 'discover_seed', 30, null),
  ('ia ref', 'regulatory', '{}', 'discover_seed', 30, null), ('me vt ref', 'regulatory', '{}', 'discover_seed', 30, null),
  ('vt ref', 'regulatory', '{}', 'discover_seed', 30, null), ('ref', 'regulatory', '{}', 'discover_seed', 30, null),
  ('ca cash refund', 'regulatory', '{}', 'discover_seed', 30, null), ('government warning', 'regulatory', '{}', 'discover_seed', 30, null),
  ('enjoy responsibly', 'regulatory', '{}', 'discover_seed', 30, null), ('please enjoy responsibly', 'regulatory', '{}', 'discover_seed', 30, null),
  -- Describing words that are not identity (and stop "sour" in "sour mash" reading as a cocktail).
  ('unfiltered', 'descriptor', '{}', 'discover_seed', 20, null), ('sour mash', 'descriptor', '{}', 'discover_seed', 20, null),
  ('hand selected', 'descriptor', '{}', 'discover_seed', 20, null),
  ('we love to hear from our customers', 'descriptor', '{}', 'discover_seed', 20, null)
on conflict do nothing;

-- 2) Category words from the PHG copy.
select public.discover_refresh_label_terms_from_phg();

-- 3) Colonel E.H. Taylor, Jr. lines -------------------------------------------------------
insert into public.discover_brand_lines(brand_name, brand_aliases, line_name, line_aliases, release_pattern, line_attributes,
  standard_proof, category_phg_id, phg_brand_id, phg_product_id, evidence_urls, notes)
values
  ('Colonel E.H. Taylor, Jr.', array['Colonel E.H. Taylor','E.H. Taylor, Jr.','E.H. Taylor','E. H. Taylor','EH Taylor','Col. E.H. Taylor','Colonel Taylor'],
   'Barrel Proof', '{}', 'annual', '{"strength":["cask_strength"]}', null,
   '56018386-e4ba-087b-ba0a-f18a3f0db876', '233c2380-fc15-4acb-a417-2304fd787f74', '0a12bb37-e220-4735-be19-80bb778ff61c',
   array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases',
         'https://www.amongstthewhiskey.com/post/colonel-e-h-taylor-barrel-proof-batch-13-review-evaluating-the-127-3-proof-2024-release'],
   'Uncut barrel proof; proof changes every release and can repeat (127.3 in 2021, 2024, 2025), so the laser year decides.'),
  ('Colonel E.H. Taylor, Jr.', array['Colonel E.H. Taylor','E.H. Taylor, Jr.','E.H. Taylor','E. H. Taylor','EH Taylor','Col. E.H. Taylor','Colonel Taylor'],
   'Single Barrel', '{}', 'continuous', '{"strength":["bottled_in_bond"],"expression":["single_cask"]}', 100,
   '56018386-e4ba-087b-ba0a-f18a3f0db876', '233c2380-fc15-4acb-a417-2304fd787f74', '52a02831-ba9d-44dd-bfdd-dc5957da2cbd',
   '{}', 'Bottled in Bond, 100 proof, 750ML as read on Rob''s bottle. Continuous line: no dated releases.'),
  ('Colonel E.H. Taylor, Jr.', array['Colonel E.H. Taylor','E.H. Taylor, Jr.','E.H. Taylor','E. H. Taylor','EH Taylor','Col. E.H. Taylor','Colonel Taylor'],
   'Cured Oak', '{}', 'limited', '{"strength":["bottled_in_bond"],"expression":["limited_release"]}', 100,
   '56018386-e4ba-087b-ba0a-f18a3f0db876', '233c2380-fc15-4acb-a417-2304fd787f74', null,
   array['https://woodencork.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026',
         'https://www.nestorliquor.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026-release'],
   'Released 2015 (17 years) and again May 2026 (10 years). No PHG product row yet.'),
  ('Colonel E.H. Taylor, Jr.', array['Colonel E.H. Taylor','E.H. Taylor, Jr.','E.H. Taylor','E. H. Taylor','EH Taylor','Col. E.H. Taylor','Colonel Taylor'],
   'Small Batch', '{}', 'continuous', '{"strength":["bottled_in_bond"],"expression":["small_batch"]}', 100,
   '56018386-e4ba-087b-ba0a-f18a3f0db876', '233c2380-fc15-4acb-a417-2304fd787f74', '148729be-7b4b-4997-9e31-cc9fd884d4aa',
   array['https://whiskeycaviar.com/blogs/news/every-e-h-taylor-barrel-proof-batch-proof-complete-release-guide'],
   '100-proof Bottled-in-Bond (source above).'),
  ('Colonel E.H. Taylor, Jr.', array['Colonel E.H. Taylor','E.H. Taylor, Jr.','E.H. Taylor','E. H. Taylor','EH Taylor','Col. E.H. Taylor','Colonel Taylor'],
   'Straight Rye', '{}', 'continuous', '{}', 100,
   '5f0d7699-e8b9-1f88-249c-8d03e1632fc6', '233c2380-fc15-4acb-a417-2304fd787f74', '3179a97d-b4d0-4f66-b515-72b958fb8a04',
   '{}', '100 proof per the PHG product row (50% ABV). Attributes not yet evidence-backed in Discover.')
on conflict (brand_name, line_name) do nothing;

-- 4) Barcodes read from Rob's bottles -------------------------------------------------------
insert into public.discover_line_barcodes(gtin, brand_line_id, package_size_ml, source, evidence)
select v.gtin, bl.id, 750, 'observed_label', v.evidence
from (values
  ('088004005528', 'Barrel Proof', 'Read on Rob''s Barrel Proof canister, 2026-11-14.'),
  ('088004005511', 'Single Barrel', 'Read on Rob''s Single Barrel back label, 2026-11-14.'),
  ('088004021290', 'Cured Oak', 'Read on Rob''s Cured Oak back label, 2026-11-14; same barcode listed for the 2026 release at https://www.rarebourbonshop.com/products/bourbon-colonel-eh-taylor-cured-oak-750ml')
) as v(gtin, line_name, evidence)
join public.discover_brand_lines bl on bl.brand_name = 'Colonel E.H. Taylor, Jr.' and bl.line_name = v.line_name
on conflict (gtin) do nothing;

-- 5) Releases -------------------------------------------------------------------------------
insert into public.discover_line_releases(brand_line_id, release_key, release_label, release_year, bottling_year, proof, age_years,
  informal_batch_label, facts, verification_state, evidence_urls, notes)
select bl.id, v.release_key, v.release_label, v.release_year, v.bottling_year, v.proof, v.age_years, v.informal_batch_label,
  v.facts::jsonb, v.verification_state, v.evidence_urls, v.notes
from (values
  ('Barrel Proof', '2014-129.0', '2014 release, 129.0 proof', 2014, null::int, 129.0, null::numeric, 'Batch 3', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null::text),
  ('Barrel Proof', '2015-127.2', '2015 release, 127.2 proof', 2015, null, 127.2, null, 'Batch 4', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2016-127.5', '2016 release, 127.5 proof', 2016, null, 127.5, null, 'Batch 5', '{"release_month":"2016-05"}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2017-128.1', '2017 release, 128.1 proof', 2017, null, 128.1, null, 'Batch 6', '{"release_month":"2017-05"}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2018-129.7', '2018 release, 129.7 proof', 2018, null, 129.7, null, 'Batch 7', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2019-129.3', '2019 release, 129.3 proof', 2019, null, 129.3, null, 'Batch 8', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2020-130.3', '2020 release, 130.3 proof', 2020, null, 130.3, null, 'Batch 9', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2021-127.3', '2021 release, 127.3 proof', 2021, 2021, 127.3, null, 'Batch 10', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases',
           'https://www.amongstthewhiskey.com/post/colonel-e-h-taylor-barrel-proof-batch-13-review-evaluating-the-127-3-proof-2024-release'],
     'Laser code reads L21.'),
  ('Barrel Proof', '2022-129.0', '2022 release, 129.0 proof', 2022, null, 129.0, null, 'Batch 11', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2023-131.1', '2023 release, 131.1 proof', 2023, null, 131.1, null, 'Batch 12', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases'], null),
  ('Barrel Proof', '2024-127.3', '2024 release, 127.3 proof', 2024, 2024, 127.3, null, 'Batch 13', '{}', 'url_backed',
     array['https://www.bourbonex.com/forums/topic/6/colonel-e-h-taylor-jr-barrel-proof-releases',
           'https://www.amongstthewhiskey.com/post/colonel-e-h-taylor-barrel-proof-batch-13-review-evaluating-the-127-3-proof-2024-release'],
     'Laser code reads L24.'),
  ('Barrel Proof', '2025-127.2', '2025 release, 127.2 proof', 2025, 2025, 127.2, null, null, '{}', 'url_backed',
     array['https://whiskeycaviar.com/blogs/news/every-e-h-taylor-barrel-proof-batch-proof-complete-release-guide',
           'https://debonairgentlemen.com/2024/01/28/e-h-taylor-barrel-proof-bourbon-in-depth-batch-list/'],
     '2025 came out at three proofs; batch numbering for them is informal.'),
  ('Barrel Proof', '2025-127.4', '2025 release, 127.4 proof', 2025, 2025, 127.4, null, 'Batch 15', '{}', 'url_backed',
     array['https://whiskeycaviar.com/blogs/news/every-e-h-taylor-barrel-proof-batch-proof-complete-release-guide',
           'https://midnightwhiskey.com/products/eh-taylor-barrel-proof-batch-16'],
     'Batch number is retailer numbering, not on the label.'),
  ('Barrel Proof', '2025-127.3', '2025 release, 127.3 proof', 2025, 2025, 127.3, null, 'Batch 16', '{}', 'url_backed_and_observed',
     array['https://whiskeycaviar.com/blogs/news/every-e-h-taylor-barrel-proof-batch-proof-complete-release-guide',
           'https://midnightwhiskey.com/products/eh-taylor-barrel-proof-batch-16'],
     'Rob''s bottle: laser L25295 = bottled 22 Oct 2025 (retailer example L25296). Batch number is retailer numbering.'),
  ('Cured Oak', '2015', 'Original 2015 release, 17 years old', 2015, null, null, 17, null, '{}', 'url_backed',
     array['https://woodencork.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026',
           'https://www.nestorliquor.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026-release'],
     'Proof not stated by these sources.'),
  ('Cured Oak', '2026', '2026 release, 10 years old', 2026, 2026, 100.0, 10, null,
     '{"release_month":"2026-05","stave_air_dry_months":13}', 'url_backed_and_observed',
     array['https://woodencork.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026',
           'https://www.nestorliquor.com/products/colonel-e-h-taylor-cured-oak-bourbon-2026-release',
           'https://onlineliquor.com/products/colonel-e-h-taylor-jr-cured-oak-bourbon-whiskey-2026'],
     'Rob''s bottle: laser L26085 = bottled 26 Mar 2026.')
) as v(line_name, release_key, release_label, release_year, bottling_year, proof, age_years, informal_batch_label, facts,
       verification_state, evidence_urls, notes)
join public.discover_brand_lines bl on bl.brand_name = 'Colonel E.H. Taylor, Jr.' and bl.line_name = v.line_name
on conflict (brand_line_id, release_key) do nothing;

-- 6) Test bottles ----------------------------------------------------------------------------
insert into public.discover_identity_fixtures(name, input, expected, evidence) values
('eh_taylor_barrel_proof_rob',
 jsonb_build_object('text', 'COLONEL E.H. TAYLOR, JR. BARREL PROOF KENTUCKY STRAIGHT BOURBON WHISKEY 127.3 PROOF 750ML '
   || 'DISTILLED AND BOTTLED BY OLD FASHIONED COPPER DISTILLERY FRANKFORT, KENTUCKY IA REF 5¢-ME/VT REF 15¢ CA CRV '
   || 'GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY '
   || 'BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR '
   || 'OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS. C02.0009116 0 88004 00552 8 L25295 01 23:41D REF IA 5¢ VT 15¢ CA CRV'),
 '{"status":"matched","brand":"Colonel E.H. Taylor, Jr.","line":"Barrel Proof","line_source":"barcode","release.key":"2025-127.3","size_ml":750,"lot.bottled_on":"2025-10-22","category.slug":"straight_bourbon","producer":"old fashioned copper distillery"}',
 'Rob''s bottle and canister, read 2026-11-14 (abridged label text).'),
('eh_taylor_single_barrel_rob',
 jsonb_build_object('text', 'COLONEL E.H. TAYLOR, JR. SINGLE BARREL BOTTLED IN BOND KENTUCKY STRAIGHT BOURBON WHISKEY 100 PROOF 750ML '
   || 'This Single Barrel Colonel E.H. Taylor is synonymous with "Topmost Class" whiskey. WE LOVE TO HEAR FROM OUR CUSTOMERS! '
   || '1-866-729-3722 WWW.GREATBOURBON.COM TAYLOR@GREATBOURBON.COM DISTILLED, AGED AND BOTTLED BY OLD FASHIONED COPPER DISTILLERY '
   || 'FRANKFORT, KY, DSP-KY-113 IA REF 5¢ - ME/VT REF 15¢ CA CRV C02.0011798 GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON '
   || 'GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. (2) CONSUMPTION OF '
   || 'ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH PROBLEMS. '
   || '0 88004 00551 1 L252500101:32N CA CRV'),
 '{"status":"matched","line":"Single Barrel","line_source":"barcode","release.key":"standard","size_ml":750,"lot.bottled_on":"2025-09-07","permit":"DSP-KY-113","attributes.strength":["bottled_in_bond"],"attributes.expression":["single_cask"]}',
 'Rob''s bottle, read 2026-11-14 (abridged label text).'),
('eh_taylor_cured_oak_rob',
 jsonb_build_object('text', 'COLONEL E.H. TAYLOR, JR. CURED OAK BOTTLED IN BOND KENTUCKY STRAIGHT BOURBON WHISKEY 100 PROOF 750ML '
   || 'Barrels were aged inside of a warehouse built by Colonel Taylor in 1881. The result is a complex bourbon with layers of depth. '
   || 'Notes of vanilla, toffee and figs are followed by subtle hints of dry oak, in honor of the man who would accept no less. '
   || 'WE LOVE TO HEAR FROM OUR CUSTOMERS! TAYLOR@GREATBOURBON.COM 1-866-729-3722 DISTILLED, AGED AND BOTTLED BY OLD FASHIONED '
   || 'COPPER DISTILLERY FRANKFORT, KY, DSP-KY-113 CA CRV C02.0019532 IA REF 5¢-ME/VT REF 15¢ GOVERNMENT WARNING: (1) ACCORDING '
   || 'TO THE SURGEON GENERAL, WOMEN SHOULD NOT DRINK ALCOHOLIC BEVERAGES DURING PREGNANCY BECAUSE OF THE RISK OF BIRTH DEFECTS. '
   || '(2) CONSUMPTION OF ALCOHOLIC BEVERAGES IMPAIRS YOUR ABILITY TO DRIVE A CAR OR OPERATE MACHINERY, AND MAY CAUSE HEALTH '
   || 'PROBLEMS. 0 88004 02129 0 L26085 01 18:22D REF IA 5¢ VT 15¢'),
 '{"status":"matched","line":"Cured Oak","release.key":"2026","release.age_years":10,"size_ml":750,"lot.bottled_on":"2026-03-26"}',
 'Rob''s bottle, read 2026-11-14 (abridged label text).'),
('barrel_proof_without_laser_code',
 '{"brand":"E.H. Taylor","product":"Barrel Proof","proof":"127.3","size":"750ml"}',
 '{"status":"ambiguous","line":"Barrel Proof","line_source":"label_words","release_candidates":3}',
 'Same proof in 2021, 2024 and 2025: without the laser code it must stay open.'),
('barrel_proof_2024_laser_code',
 '{"brand":"E.H. Taylor","product":"Barrel Proof","proof":"127.3","size":"750ml","lot_code":"L24290 01 10:15D"}',
 '{"status":"matched","release.key":"2024-127.3"}',
 'Synthetic variant: same proof, 2024 laser year.'),
('barrel_proof_unknown_2026_batch',
 '{"brand":"E.H. Taylor","product":"Barrel Proof","proof":"127.3","size":"750ml","lot_code":"L26100 01 09:00D"}',
 '{"status":"new_release_candidate","line":"Barrel Proof"}',
 'Synthetic variant: a release we do not know yet must not be forced onto an old one.'),
('cured_oak_without_laser_code',
 '{"brand":"E.H. Taylor","product":"Cured Oak","proof":"100","size":"750ml"}',
 '{"status":"ambiguous","release_candidates":2}',
 'Cured Oak 2015 and 2026: the laser code (or age) decides.'),
('single_barrel_from_reader_fields',
 '{"brand":"E.H. Taylor","product":"Single Barrel","proof":"100 proof","size":"750 ml"}',
 '{"status":"matched","line":"Single Barrel","release.key":"standard","identity_key":"colonel e h taylor jr|single barrel|standard|750ml"}',
 'What the live reader sends today (brand + product fields only).'),
('category_words_are_not_a_product',
 '{"brand":"Buffalo Trace","product":"Kentucky Straight Bourbon Whiskey","size":"750ml"}',
 '{"status":"line_unknown","line":null,"category.slug":"straight_bourbon","flag:reader_product_is_only_category_words":true}',
 'The current DEV candidate list has this mistake; the class statement must not become the product name.'),
('barcode_beats_label_words',
 '{"text":"COLONEL E.H. TAYLOR SINGLE BARREL","gtin":"088004005528","proof":"127.3","lot_code":"L25295"}',
 '{"line":"Barrel Proof","line_source":"barcode","release.key":"2025-127.3","flag:barcode_and_label_words_disagree":true}',
 'Barcode wins over a misread word, and the disagreement is flagged.')
on conflict (name) do update set input = excluded.input, expected = excluded.expected, evidence = excluded.evidence;
