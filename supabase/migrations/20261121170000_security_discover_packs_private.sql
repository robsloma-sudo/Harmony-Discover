-- Discover DEV · Access & Security · P-20261121-1604 · make storage bucket discover-packs private.
-- Rob's decision (21 Nov 2026): "No, make it private".
-- Findings: the only program that touches this bucket is discover-catalog-sync (action letter_pack, weekly job
-- discover-letter-pack-weekly), which WRITES letter-bags-v1.tsv.gz with the service role key. No app code,
-- other server program or other repo reads the file; the object has not been read since it was created
-- (16 Nov 2026) and recent request logs show no downloads. So the read rule is: server only.
-- The service role bypasses storage row security, so the weekly writer keeps working with no policy.
-- Deliberately NO storage.objects policy is added: anon and signed-in users get no access at all.
-- Touches only bucket discover-packs. Rollback: supabase/rollback/20261121170000_security_discover_packs_private_ROLLBACK.sql

update storage.buckets
   set public = false
 where id = 'discover-packs';

do $$
begin
  if exists (select 1 from storage.buckets where id = 'discover-packs' and public) then
    raise exception 'discover-packs is still public';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual,'') ilike '%discover-packs%' or coalesce(with_check,'') ilike '%discover-packs%')) then
    raise exception 'unexpected storage policy mentions discover-packs';
  end if;
end $$;
