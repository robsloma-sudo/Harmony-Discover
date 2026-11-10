# v1.0 — Harmony Knowledge Gap Engine

## Purpose
Prioritize where Harmony should investigate or improve its own knowledge and user experience. This is internal product learning—not a consumer data product and not a market research claim.

## Signal sources
The engine accepts minimized, aggregate-consented signals from:
- Unanswered questions and no-result searches.
- Low explicit answer satisfaction.
- Rejected entity matches.
- Repeated recipe adjustments.
- Journey drop-off.
- Knowledge conflicts and source-coverage audits.

Free-text question content is not an input. The engine uses normalized topic keys and counts only.

## Domains
- Cocktail Intelligence
- Flavor Intelligence
- Wine Intelligence
- Menu Intelligence
- Harmony Journeys
- Harmony Reason
- Discover UX

## Ranking behavior
- Evaluates the last 30 days.
- Groups by domain and normalized topic key.
- Requires at least 10 distinct consenting subjects and 3 observed days before assigning normal/high/urgent priority.
- Scores unanswered activity, low explicit satisfaction, source coverage gaps, severity, and breadth.
- Emits a suggested next action: observe more, audit existing knowledge, commission research, or review experience.
- A low score or insufficient cohort never means Harmony's knowledge is correct; it means the signal is not strong enough to prioritize.

## Important safeguards
1. Signals are self-selected and can be affected by app adoption, UX placement, feature launches, and sampling bias.
2. Use active eligible user/session denominators in the server aggregation layer before using score changes for planning.
3. Explicit satisfaction is distinct from inferred sentiment.
4. Source coverage must come from an internal source audit, not user activity.
5. No individual-level data or raw question text is displayed.
6. The engine creates candidates only. It cannot edit canonical knowledge, recipes, Journeys, prompts, or production systems.
7. Research must use source-backed evidence and follow each domain's validation requirements.

## Integration contract
The productionized Discover API should:
1. Resolve current aggregate-research consent at query time.
2. Query only minimized topic aggregates from the isolated Discover database.
3. Run the pure TypeScript evaluator.
4. Persist candidates in `learning_trend_candidates` or a dedicated gap-candidate table in the isolated development database.
5. Create research tasks only after human review.
6. Record reviewer identity, decision, evidence links, and timestamps.
7. Route approved work into the appropriate Harmony development workflow.

## Limitations
This increment adds a deterministic evaluator and tests. It does not connect to production Harmony data, query consumer events, persist candidates, or execute research tasks. The current scoring weights are initial heuristics and must be calibrated with a real pilot and reviewer feedback.
