# Rollback for FIX-003 (discover-live-autosave v0.6.1)

No database change was made by this fix, so there is nothing to undo in the database.

To undo the code change:
1. Revert the FIX-003 merge commit on `main` (GitHub: "Revert" button on the pull request).
2. Redeploy the previous program: `supabase functions deploy discover-live-autosave --project-ref lqqmwqrffelgnbngrkep --no-verify-jwt`
   from the reverted `main` (this is v0.6.0, the copy that was live on 2026-11-20, live version 24).
3. Check: `{"action":"health"}` returns `version: "0.6.0"`.

The login-check switch must stay OFF (verify_jwt false), as it is today; the program checks the sign-in itself.
