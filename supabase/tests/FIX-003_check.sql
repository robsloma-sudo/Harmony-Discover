-- FIX-003 read-only checks (Discover dev, lqqmwqrffelgnbngrkep). Run before and after deploying v0.6.1.

-- 1. Research outcomes by program version: after v0.6.1 is live, new dropped rows with reason
--    'no_score' / 'no_source' appear, and kept facts all have a source host.
select model_version, outcome, reason, count(*),
       count(*) filter (where outcome = 'kept' and source_host is null) as kept_without_source
from discover_research_outcomes
where created_at > now() - interval '3 days'
group by 1, 2, 3 order by 1, 2, 3;

-- 2. Evidence saved by research since the deploy (replace the time): every row should name the field it supports.
-- select metadata->>'researched_by' as by_, source_type, count(*)
-- from discover_product_evidence
-- where captured_at > '2026-11-20T00:00:00Z' and metadata ? 'researched_by'
-- group by 1, 2 order by 3 desc;
