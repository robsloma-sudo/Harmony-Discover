# Partial evidence: naming bottles whose label is partly hidden (steps 1–4)

Rob, 17 Nov 2026. Branch `claude/discover-partial-evidence` (on top of PR #108).
The case: E.H. Taylor Cured Oak and Barrel Proof canisters standing behind a Knob Creek 21. Each read sees only part of a label ("TAYLO", "CURED"); the old letter lookup scored one word at a time against brands and ranked plain "Taylor" first, and a cut read ("TAYLOR Kentucky Straight Bourbon") was once saved as brand "Taylor".

Rules kept: a guess is shown only as **"Probably …"** and is never saved; a bottle is confirmed (and auto-saved) only by the evidence engine. Claude only reads and chooses; names come from the catalogue (US label approvals, Harmony catalogue) and the scan scene.

## What was built

| Step | Where | What it does |
|---|---|---|
| 1. Joint part-word lookup | `discover_partial_lookup` (DEV migration 20261117200704), `src/live/partialEvidence.ts` | Pools every word and part-word the reads of one bottle saw. The database returns names (brand **and** product, label approvals + Harmony catalogue) containing up to 6 of them (trigram index, ~80 ms worst case). The app scores each name: each piece goes to the word it fits best (a word cut at either edge still fits); descriptors ("Single Barrel") help pick a product but never a maker; kind-of-drink words only check bourbon vs scotch etc. It shows a name only with a clear lead over every other maker; the product only when a product word was seen and leads that maker's other products. |
| 2. Scene memory | `partialEvidence.ts`, `app/index.tsx` | Names confirmed this scan session, plus (while checked in) the venue's crowd feed: bottles seen there and items on menus scanned there. The scene only **breaks near-ties**; it cannot overturn what the words clearly say. |
| 3. Occlusion | `src/live/occlusion.ts`, `trackEvidence.ts`, `DiscoverARSurface.tsx` | A box is *partial* when a nearer bottle (its base lower in the picture, or bigger at the same base) covers ≥15 % of its label, or it stands right beside such a bottle, or it is cut at the picture's side/bottom; also when the reader says `cut_off`. Partial reads are clues: they add evidence at 60 % weight but **cannot confirm a name on their own**. Words from the bottle in front (once that one is confirmed) are ignored. A box is read again at once when more of it comes into view; after 3 partial reads it rests 20 s. |
| 4. Targeted check | `discover-verify-read` (new Edge Function, v0.1.0) | For a bottle with a leading name, one Haiku look at the latest label crop: "which of these (≤3) names does the visible text belong to, 0 if none or a tie?" Products are asked when one is clear, otherwise makers. Accepted only if the visible words the model lists back the chosen name with a word that tells it apart from the others ("TAYLOR" does not back E.H. Taylor when Duncan Taylor is also listed). A match counts as one full read, so it can confirm the bottle. |

Cost caps for step 4: at most 2 checks per bottle, one at a time, ≥4 s apart, only with a crop ≤6 s old; server: 8 checks/min per user, and each check counts toward the existing daily scan caps (400 per user, 5,000 project). Partial labels with a leading name skip the Sonnet second look.

## Measured (before release)

`scripts/partial-evidence-eval.ts` and `/tmp` harness: 50 real label texts from Discover sightings (Rob's shelf, 16–17 Nov), 291 simulated occlusions (words dropped, words cut at either edge), live catalogue.

| Scene | Named | Wrong maker |
|---|---|---|
| none | 44 % | 0 |
| same maker confirmed earlier this session | 65 % | 0 |
| busy shelf: 10 other real bottles confirmed, true maker absent | 43 % | 0 |
| 25 made-up or one-word inputs (TAYLOR, CREEK, JACK…) | 0 shown | — |

Live check (synthetic label crops): Cured Oak canister half covered by a "KNOB CREEK" bottle → match, product level; only "COLONEL E.H. TAYLOR, JR." visible → match, brand level (makers asked); Michter's label → no match.

Field metrics now logged per bottle (`discover_scan_timings`, app version `pe1-*`): `partial`, `guess_source`, `verify_calls`, `verify_verdict`, plus `ms_to_name` / `ms_to_confirm` and `guess_agreed`:
- time to name: `ms_to_name` where `guess_source = 'partial'`;
- share of hidden bottles named: rows with `partial` and (`guess_brand` or `brand`) / rows with `partial`;
- wrong-name rate: `guess_agreed = false` / rows with `guess_brand` and `brand`.

## Not done / limits

- **Harmony menu pages** (PHG) are not in the scene yet: Discover can only fetch them as page images. Adding them needs a read-only PHG function returning the brands on a venue's Harmony menus. That is a PHG production change and needs Rob's OK.
- Simulation is not the shelf: the field metrics above are the real test.
- Brands only in COLA under a distributor's or parent company's name (Jas Hennessy, Moet Hennessy) block some correct guesses (it stays silent rather than guess).
- Steps 5 (appearance profiles) and 6 (LiDAR size) are later.

## Changelog

- **pe1 (17 Nov 2026)**: steps 1–4 as above. DEV: migrations 20261117200704 (lookup) and 20261117202951 (timing metrics), Edge Function `discover-verify-read` v0.1.0 deployed. Tests: 22 new unit tests (scoring with recorded catalogue answers, occlusion, evidence rules, check backing), SQL smoke test `tests/sql/discover-partial-evidence-smoke.sql`.
