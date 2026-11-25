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

> **Retired (21 Nov 2026, kit S4-D5-002).** This worker was never hosted. Its `validate_assets` jobs are now closed
> automatically after one day by `public.discover_expire_photo_checks()` (daily timed job
> `discover-expire-photo-checks-daily`). The live menu reader (`discover-menu-read`) reads uploaded pages directly,
> and the app re-saves each page as JPEG on the phone before upload. To bring the worker back, host it and run the
> rollback in `supabase/rollback/20261121180000_discover_retire_photo_check_queue_ROLLBACK.sql`.

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
