# v1.2 — Learning API integration scaffold

## Added API routes

### `GET /v1/learning/consent`
Requires a valid Discover Supabase access token. Returns the latest effective state for each of the three purposes.

### `PUT /v1/learning/consent`
Requires authentication and a strict body containing policy version and three booleans. Writes a new consent-history row for each purpose. A false choice is recorded with a withdrawal timestamp; history is retained for audit.

### `POST /v1/learning/events`
Requires authentication. The server derives the subject ID from the verified access token and ignores any client-supplied identity. It:
- validates a strict, allow-listed event envelope;
- resolves current consent from the Discover database;
- rejects direct identifiers and free-text/raw image fields through schema restrictions and policy validation;
- stores only minimized structured fields;
- marks eligibility for personalization and aggregate research separately;
- uses the client event UUID for idempotency.

Question text is intentionally not accepted by this endpoint. A separate encrypted question vault flow, redaction, retention, and key management must be implemented and reviewed before conversation analysis is enabled.

## Important limitations / pre-pilot blockers
- API routes are scaffold code; not run, compiled, or deployed in this session.
- The service uses the isolated Discover development Supabase configuration only. The existing production project ID is blocked by the API database client guard.
- Current consent resolver uses latest row per purpose. A production implementation must also handle policy-version migration, concurrent withdrawal races, and transactionally consistent event acceptance.
- Consent history table RLS is server-only; service credential remains exclusively in API runtime.
- Anonymous-first-use is not implemented by these authenticated routes; the MVP can still allow local scan/preview before account creation, but cross-device learning events need a verified pseudonymous account.
- Staff RBAC, review-console persistence, audit log, and learning candidate creation are not wired.
- No free-text conversation storage, automatic model training, or canonical knowledge updates are enabled.
- Before enabling consumer traffic, add rate limits by verified subject, payload quotas, retention/deletion propagation, privacy review, and API integration tests.

## No production writes
No SQL was executed. No production Supabase object or data was changed. Apply the development migrations only to a separately provisioned Discover development project after explicit authorization.
