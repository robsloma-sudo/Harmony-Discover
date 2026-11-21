-- ROLLBACK for supabase/migrations/20261121170000_security_discover_packs_private.sql
-- Restores the previous state exactly: bucket discover-packs public again (no policies were added, so none to drop).
update storage.buckets
   set public = true
 where id = 'discover-packs';
