# Phase 5 — Discover DEV enrichment worker operations

## Scope and safety

This worker is designed for the isolated Discover DEV project only:
- Supabase project ref: `lqqmwqrffelgnbngrkep`
- Edge Function: `discover-enrichment-worker`
- Migration source: `20261112182500_discover_strict_sighting_attach_and_queue_claim.sql`

The worker explicitly checks the configured Supabase hostname against the Discover DEV project ref before creating a client. Do not change that guard to point at Harmony/PHG production. The migration is source code only until it has been reviewed and separately approved for application.

## Current supported work

The worker currently claims only `identity_match` jobs. It verifies that:
1. the job contains valid job, product, and sighting identifiers;
2. the Discover product exists;
3. the sighting is attached to that same Discover product;
4. a `catalog_exact` identity has its required legacy catalog link.

It writes a bounded completion payload and clears its lock only if the job is still processing and locked by the same worker. Failures use exponential retry delay (30 seconds, doubling per attempt, capped at one hour) and transition to terminal `failed` when the attempt budget is exhausted.

## Deferred work

`official_source_lookup`, barcode/UPC lookup, COLA lookup, field extraction, conflict resolution, and refresh are deliberately not claimed. Do not mark those jobs complete until a source-specific provider, official-domain policy, provenance checks, evidence schema mapping, timeout, and cost budget are implemented and tested. In particular, a search result or model-generated URL must never be written as verified evidence without independent source validation.

## Required function secrets

- `SUPABASE_URL`: must resolve to `https://lqqmwqrffelgnbngrkep.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Discover DEV service-role key
- `DISCOVER_ENRICHMENT_WORKER_TOKEN`: high-entropy private token supplied in the `x-discover-worker-token` header

Never put the service-role key or worker token in browser code, repository files, logs, or Slack.

## Invocation contract

- Method: POST
- Content type: `application/json`
- Header: `x-discover-worker-token: <secret>`
- Body: `{"limit": 5, "worker": "discover-identity-worker"}`
- Maximum batch size: 5
- Queue claim: atomic `SKIP LOCKED`, worker-specific lock, six-hundred-second stale-lock window.

Do not schedule or deploy this worker until the migration is reviewed and applied to Discover DEV, the required secrets are configured, and a controlled DEV test is explicitly approved. A scheduled invocation can be configured through Supabase Edge Function scheduling after deployment; no schedule is created by this source change.

## Operational acceptance still required

- Deploy only to Discover DEV after approval.
- Run controlled sightings and verify attach -> evidence -> queue -> worker completion.
- Exercise two concurrent workers and confirm no job is claimed twice.
- Exercise retry exhaustion and stale-lock recovery.
- Add queue-age, retry-rate, failure-rate, and oldest-stuck-job metrics/alerts.
- Implement and test official-source lookup separately.
- Verify PHG export remains staged/manual-review only; no production writes.
