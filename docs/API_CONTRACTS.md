# API contracts (proposed)

- POST /v1/observations
- POST /v1/observations/{id}/assets
- POST /v1/observations/{id}/complete
- GET /v1/observations/{id}
- GET /v1/observations/{id}/items
- POST /v1/observations/{id}/venue
- POST /v1/journeys
- GET /v1/journeys/{id}
- POST /v1/collections
- POST /v1/observations/{id}/freshness

Use versioned schemas, authenticated upload authorization, idempotency keys, request validation, rate limits, and resumable jobs.
