# Menu extraction schema

Every extracted field carries:
- literal value or null
- confidence from 0 to 1
- evidence state (`menu_observed`, `verified`, `inferred`, `unknown`)
- source page
- supporting source text
- method used

The baseline line extractor only captures visible text and obvious printed prices. It does not guess ingredients, producer, grape, vintage, style, or exact product identity. Category defaults to `unknown` until a separate classification/matching step is implemented and validated.

The OCR provider is a vendor-neutral HTTP adapter. It is intentionally unconfigured by default. Before selecting a vendor, assess contractual retention, data processing terms, regional processing, image reuse for model training, security, latency, per-page pricing, and OCR accuracy on real menus.
