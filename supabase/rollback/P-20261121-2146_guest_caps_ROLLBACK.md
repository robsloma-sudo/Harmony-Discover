# Undo P-20261121-2146 part 3 (Discover DEV only)

1. Server programs: redeploy the previous versions of discover-live-read (0.5.6), discover-menu-read and
   discover-live-autosave (0.6.1) from `main` before this PR. Guests then go back to the normal per-person caps.
   Faster, without a redeploy: raise any guest number with its setting (for example
   DISCOVER_GUEST_IMAGES_PER_ACCOUNT=400) so it no longer bites.
2. Database: run `supabase/rollback/20261122120000_discover_guest_daily_caps_and_backup_cleanup_ROLLBACK.sql`.
   It removes the guest helper and its table and restores the 16 Nov backup table with all 103 rows
   (check: count = 103, md5 368e560ab735460a40f67e4aca36c8fe).
3. Test program: redeploy `recovered/deployed-functions/discover-live-read-test/v5/index.ts` as
   discover-live-read-test with verify_jwt = false, and put its two lines back in supabase/config.toml.
