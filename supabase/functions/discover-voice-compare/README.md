# discover-voice-compare (removed)

The hidden Marty listening test was removed on 26 Nov 2026 (P-20261126-0102, Rob: "delete the voice listening tests").
This function is now a stub that answers every request with `410 {"error":"The listening test has been removed.","code":"gone"}`.
It reads no secrets, checks no sign-in, touches no database and calls no paid provider.

Marty's ElevenLabs voice (Rob's own voice "Marty") is now part of the live program `discover-voice-session`; see its README.
The old switches `MARTY_COMPARE`, `MARTY_COMPARE_USERS` and `MARTY_COMPARE_ORDER` are no longer read by anything; Rob clears them himself.
Deploy with `verify_jwt` false (one file: `discover-voice-compare/index.ts`).
