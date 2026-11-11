# Discover API and worker scaffold

This service is development-only and is not production deployable yet.

## Local setup
1. Provision a dedicated Harmony Discover DEVELOPMENT Supabase project, separate from Harmony production.
2. Apply migrations `0001` then `0002` only to that development project after review.
3. Configure the private `observation-assets` bucket through migration 0001.
4. Copy `.env.example` to `.env` with development-only server credentials.
5. Install dependencies: `npm install`
6. Start API: `npm run dev`
7. Start worker in another terminal: `npm run worker`

## Implemented scaffold endpoints
- `GET /health`
- `POST /v1/observations`
- `POST /v1/observations/:id/assets`
- `POST /v1/observations/:id/complete`

## Worker behavior
- Claims jobs with a Postgres `FOR UPDATE SKIP LOCKED` function.
- Checks JPEG/PNG/WebP signatures and byte-size consistency.
- Computes SHA-256 hashes.
- Re-encodes supported images to JPEG, which strips EXIF metadata.
- Stores normalized image path and processing event.
- Uses bounded retry/backoff and stale-lock recovery.

## Explicitly not implemented
- OCR provider integration or menu-item extraction.
- HEIC decoding (currently rejected by worker despite API accepting MIME; do not enable HEIC in a pilot).
- Cross-observation perceptual duplicate detection.
- Durable queue monitoring/dead-letter UI.
- Venue matching and canonical product resolution.
- Journey generation and consumer read endpoints.
- Data retention/deletion workflow.
- Automated test suite and production security review.

The worker currently marks extraction state `ocr_unconfigured`. This is intentional: it does not fabricate OCR or pretend a menu has been parsed.
