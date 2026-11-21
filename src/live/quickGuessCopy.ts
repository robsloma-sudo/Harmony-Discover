/**
 * Settings > Quick Guess wording (P-20261121-1600, Rob 21 Nov 2026: "Add a notice").
 * The notice must match what Quick Guess actually sends:
 *  - up to 6 words read off a label go to the Discover database to look up the brand
 *    (discover_letter_lookup / discover_fragment_lookup, see services/discoverLetterApi.ts);
 *  - those words are saved in the scan timing record with how fast the bottle was named, label size,
 *    zoom, device type, the guess and the final name, under the signed-in Discover account
 *    (discover_log_scan_timings; ScanTimingRow);
 *  - no photo is sent by Quick Guess (the reader runs on this device).
 * If any of that changes, change this wording and tests/quick-guess-notice.test.ts together.
 */
export const QUICK_GUESS_MAX_WORDS_SENT = 6;

export const QUICK_GUESS_DESCRIPTION =
  'This device reads the biggest words on a label itself and shows "Probably …" before the full read arrives. Hold still. Uses more battery.';

export const QUICK_GUESS_DATA_NOTICE =
  `What it sends: up to ${QUICK_GUESS_MAX_WORDS_SENT} words it reads on each label go to Harmony's servers to look up the brand. ` +
  'They are saved with timing details (how fast the bottle was named, label size, zoom, device type, the guess and the final name) ' +
  'and your Discover account ID, to make guesses faster and more accurate. Quick Guess sends no photos.';
