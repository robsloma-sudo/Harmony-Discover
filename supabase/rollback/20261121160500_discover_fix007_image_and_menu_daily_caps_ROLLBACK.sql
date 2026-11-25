-- ROLLBACK for supabase/migrations/20261121160500_discover_fix007_image_and_menu_daily_caps.sql
-- Run ONLY after redeploying the previous discover-live-read (v0.5.5) and discover-menu-read sources
-- (git revert of the FIX-007 PR), otherwise those programs would call functions that no longer exist.
-- Note: the per-person menu page counts in discover_menu_read_usage are dropped with the table (usage counters only).
drop function if exists public.discover_menu_page_allow(uuid, integer, integer, integer);
drop table if exists public.discover_menu_read_usage;
drop function if exists public.discover_bottle_scan_allow_units(uuid, integer, integer, integer);
comment on column public.bottle_scan_usage.frames is null;
