-- Harmony Discover DEV: propose research hints daily (proposals only; a person promotes them).
select cron.schedule('discover-propose-research-hints', '15 4 * * *', $$select public.discover_propose_research_hints()$$);
