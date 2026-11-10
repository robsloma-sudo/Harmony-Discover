# v0.8 — Learning signal evaluation

## Scope
The Learning Engine now has a deterministic, testable trend-evaluation function. It is deliberately called an **internal learning signal**, not a consumer-market trend. Discover's users are a self-selected sample and do not represent the general public.

## Evaluation rules
- Only signals whose current, authoritative aggregate-research consent is true may enter the evaluator.
- Signals are grouped by a normalized topic key and beverage category.
- Current window: 28 days. Baseline: preceding 28 days.
- Default minimums: 25 distinct consenting subjects, 30 sessions, observations across at least 7 distinct days, and at least 10 baseline events.
- Default change threshold: 20% up or down.
- Failing any evidence gate returns `insufficient_evidence`, never a trend label.
- Results expose counts and a status, not subject-level records or free-text questions.

## Important interpretation limits
1. A signal is not a causal explanation.
2. A rise in Discover activity can reflect app growth, a feature launch, a notification, or a sampling shift—not necessarily a real-world preference shift.
3. Compare rates per active eligible user/session as well as raw counts in the production evaluator.
4. Keep geography coarse; do not publish small-region or rare-topic cuts.
5. Suppress or combine topics where the cohort is sparse or re-identification risk is elevated.
6. A candidate can create a research task, but never directly alter canonical Harmony knowledge.

## Next engineering gates
- Replace in-memory evaluation input with a consent-filtered server-side query/materialized aggregate in the isolated Discover database.
- Add rate denominators (eligible active users/sessions) and app-version/feature-launch annotations.
- Add confidence intervals or a pre-registered Bayesian/ frequentist method before asserting statistical significance.
- Add trend candidate deduplication, reviewer decisions, evidence links, and outcome measurement.
- Add deletion/withdrawal recomputation before pilot.
- Security review and privacy review before collecting real consumer data.

## Not implemented
No aggregate job, database execution, dashboard, deployment, or production integration is performed by this increment. The evaluator is pure TypeScript and testable offline.
