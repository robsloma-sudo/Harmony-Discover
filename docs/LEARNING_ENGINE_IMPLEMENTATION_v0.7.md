# Learning Engine — v0.7 implementation contract

**Status:** Isolated development scaffold. Nothing in this package has been deployed or run against a database. Existing Harmony production Supabase remains read-only.

## Added in v0.7
- Versioned TypeScript event contract and allow-listed event taxonomy.
- Server-side ingest decision function designed to consume authoritative, current consent loaded by the API.
- Forbidden-property checks for direct identifiers and raw question/photo fields.
- Separate encrypted-question storage contract.
- Owner-scoped private taste profile table.
- Internal trend candidate, research task, improvement proposal, and outcome measurement tables.
- RLS enabled on all new tables; raw events, consent, questions, and learning operations have no client-facing policies.
- Unit-test examples for identifier rejection and consent gating.

## Consent enforcement contract
The device's consent snapshot is never the authorization source. The API loads the latest consent record for each purpose and checks withdrawal status before accepting or using an event. Personalization, aggregate research, and question analysis remain independent permissions. A question body is never stored in `learning_events.properties`; encrypt it in the API before storing it in the separate question vault, redact it before analysis, and set a short retention deadline.

## Initial aggregation privacy rule
Do not render a segment unless it has at least 25 distinct consenting subjects and spans at least 7 days. Also review uniqueness of the category/region combination; raise thresholds for rare topics and small geographies. This threshold is a starting safeguard, not a guarantee against re-identification. Never expose raw text or user-level drill-down in the learning console.

## Remaining work before pilot
1. Implement server-issued, purpose-scoped pseudonymous IDs; do not use advertising IDs.
2. Implement authoritative consent history resolution and withdrawal-race handling.
3. Add idempotent ingestion, payload limits, rate limits, and abuse controls.
4. Implement server-side question encryption and key management.
5. Implement consent withdrawal, deletion propagation, retention, and aggregate recomputation jobs.
6. Add trend baseline/statistical logic and sampling-bias review.
7. Build reviewer UI and approval gates; no automatic canonical knowledge changes.
8. Add security/privacy review and real-device tests.

The SQL is a development migration template only. It has not been executed. The TypeScript policy is a testable starting point, not a complete production authorization system.
