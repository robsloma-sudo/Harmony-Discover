-- SUPABASE-ONLY. DEVELOPMENT ONLY. Discover DEV project.
-- Advisor 0014 (WARN): pg_net was installed with schema public by the first version of 0010 (now corrected).
-- pg_net is not relocatable, so it is reinstalled in `extensions`. Its functions always live in schema `net`,
-- so the pg_cron job (net.http_post) is unaffected. Only the response log table (net._http_response) is reset.
drop extension if exists pg_net;
create extension pg_net with schema extensions;