# Rollback for FIX-011 (time limits on outside calls)

## Database (timed jobs)
Run `supabase/rollback/20261121060000_discover_catalog_sync_split_daily_ROLLBACK.sql` on Discover dev
(`lqqmwqrffelgnbngrkep`). It removes the four separate nightly calls and restores the single 06:10 UTC
`discover-catalog-sync-daily` call exactly as it was. No data is touched.

## Server programs
1. Revert the FIX-011 merge commit on `main` (GitHub "Revert" button on the pull request).
2. Redeploy from the reverted `main`, keeping today's login-check switches:
   - `supabase functions deploy discover-live-read --project-ref lqqmwqrffelgnbngrkep --no-verify-jwt` (back to v0.5.4, live version 32)
   - `supabase functions deploy discover-menu-read --project-ref lqqmwqrffelgnbngrkep` (login check ON, live version 20)
   - `supabase functions deploy discover-catalog-sync --project-ref lqqmwqrffelgnbngrkep --no-verify-jwt` (back to v0.4, live version 8)
3. Check: `discover-live-read` `{"action":"health"}` returns `version: "0.5.4"`.
