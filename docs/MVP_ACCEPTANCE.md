# MVP acceptance criteria

1. App runs on physical iOS and Android devices.
2. User can start without an account.
3. User can capture or select multiple menu pages.
4. Draft survives app interruption.
5. User can preview extracted items.
6. User can select an item and start a Journey.
7. Journey distinguishes menu-observed, verified, inferred, and unknown information.
8. No privileged secrets are shipped in the mobile bundle.
9. Production Supabase is never written to.
10. Upload and processing failures are recoverable.
11. Privacy, consent, deletion, and retention flows are documented before public launch.

Current starter only demonstrates local capture and mock extraction/Journey content. Items 4, 6-11 require further implementation and testing.
