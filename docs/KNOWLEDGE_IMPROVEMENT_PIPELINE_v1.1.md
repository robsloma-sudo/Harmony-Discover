# v1.1 — Harmony Knowledge Improvement Pipeline

## Purpose
Turn a reviewed knowledge gap into a controlled, evidence-backed improvement with independent approval, implementation traceability, outcome measurement, and rollback.

## State machine
`candidate → research_requested → research_in_progress → evidence_ready → proposal_submitted → approved → implemented → measuring → completed`

Alternate paths:
- `proposal_submitted` or `evidence_ready` → `rejected`
- `implemented`, `measuring`, or `completed` → `rolled_back`

The pure TypeScript state machine rejects out-of-order transitions.

## Evidence gate
A proposal requires at least two reliable evidence records from at least two distinct publishers. Consumer signals can motivate research but do not count as independent factual evidence. Allowed evidence types include primary sources, peer-reviewed research, official references, validated internal datasets, and expert review. A record must include a URL, publisher, access date, claim supported, and reliability assessment.

This is an initial conservative gate. Some claims require stronger evidence, primary legal/regulatory references, or domain-specific technical review.

## Separation of duties
- The proposal author cannot approve their own proposal.
- The reviewer cannot approve a proposal they reviewed.
- The approver cannot be the implementer.
- Implementation requires a version identifier.
- Completion requires a measured outcome.
- Rollback requires a concrete rollback reference.

The TypeScript module validates workflow invariants. Real authentication, RBAC, database transactions, and immutable audit persistence must be enforced by the API/database; never trust a client-supplied actor identity.

## Outcome measurement
Each approved improvement must define:
- Target component and exact change.
- Evidence and hypothesis.
- A pre-change baseline.
- A target metric.
- A measurement window and measured result.
- Implementation version and rollback reference.

Possible metrics include answer helpfulness, factual correction rate, Journey completion, successful entity resolution, or recipe remix satisfaction. Do not optimize alcohol consumption, frequency, or spend.

## Integration path
1. Knowledge Gap Engine emits a candidate.
2. Human reviewer requests research.
3. Research task gathers independent sources.
4. Evidence is reviewed and attached.
5. Proposal is submitted.
6. Independent approver authorizes implementation.
7. Development owner implements in the relevant isolated Harmony environment.
8. Outcome is measured.
9. The change is retained, revised, or rolled back.

## Current implementation status
- Pure TypeScript workflow state machine added.
- Evidence metadata contract added.
- Separation-of-duties and order-of-operations checks added.
- Unit tests cover evidence, approval, implementation, measurement, audit trail, and rollback.
- No API route, database persistence, staff authentication, production integration, or deployment is connected.
- No production Supabase changes.
