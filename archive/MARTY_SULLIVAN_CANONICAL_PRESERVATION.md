# Marty Sullivan — Canonical Preservation Record

**Status:** PRESERVED SOURCE / NOT YET INTEGRATED  
**Canonical character name:** Marty Sullivan  
**Original source project:** Harmony Voice Audition  
**Floot project ID:** `8f8567ef-ad72-4c60-b3ad-a647e0ac5fd9`  
**Source project version inspected:** `1794257149693`  
**Harmony Discover development branch:** `discover-source-import-2026-11-10`  
**Archive location:** `archive/marty-sullivan-original/`

## Preservation rule

The original Harmony Voice Audition project is the source archive and must remain intact. Do not overwrite, rename, publish, delete, or repurpose it. Do not connect it to Harmony production. This GitHub archive is a working preservation copy of the custom character and voice-engine source files; the original project remains the authoritative complete project, including its database, authentication, settings, and project history.

## What was recovered

### Character and performance
- Older masculine neighborhood bartender, approximately 60, decades behind the bar.
- Gruff, impatient, foul-mouthed, dry, sharp-witted and blunt; warmth underneath the bark.
- Strong comic point of view; specific observational humor, surprise, misdirection, escalation, understatement, callbacks, wordplay, timing and restraint.
- Reacts to the actual guest and their words rather than reciting fixed jokes.
- Can banter, spar, handle playful insults, recommend drinks and teach beverage topics.
- Must prioritize factual accuracy for cocktails, spirits, wine, beer, hospitality, flavor and technique.
- Must recognize distress and genuine vulnerability, stop roasting the person's pain, and respond humanely.
- Must not target protected traits, disability, trauma or sensitive personal characteristics; do not psychoanalyze or turn personal vulnerabilities into material.
- No impersonation of a real comedian or copied routines; the comedy craft examples are original.

### Important location / identity reconciliation
The recovered Voice Audition source is internally consistent about a **New York neighborhood bartender**, with New York working-class voice direction. Some earlier design discussion in the wider Discover work referred to a **South Boston / Boston bartender**. The user has now selected the canonical name **Marty Sullivan**.

Do not silently overwrite the original New York prompt. Preserve it verbatim as historical source. Before integration, create a new versioned Marty Sullivan prompt that intentionally resolves the setting, biography, accent and local vocabulary to the user's chosen Boston direction. No exaggerated phonetic spelling or cartoon accent.

### Comedy intelligence and evaluation
- `helpers/comedyIntelligence.tsx`: original comedy craft layer, 71 lines.
- `helpers/comedyScenarios.tsx`: 33 original test scenarios across observational humor, misdirection, satire, analogy, deadpan, callbacks, escalation, timing, practical wit and judgment.
- `pages/comedy-lab.tsx` and `pages/comedy-lab.module.css`: scenario deck and human-scored review interface.
- Six evaluation dimensions: specificity to guest, originality/surprise, timing/punchline shape, naturalness of spoken delivery, character consistency, and restraint.
- The lab is human-reviewed; it does not automatically grade a response or train model weights.

### Live voice and speech architecture
- `endpoints/realtime-token_POST.ts`: server-side Realtime client-secret minting, guest context and feedback loading, session instruction composition, audio input/output and turn detection.
- `endpoints/realtime-token_POST.schema.ts`: request validation.
- Realtime session used browser WebRTC and a short-lived client credential. The permanent API key stays server-side.
- The inspected configuration selected model `gpt-realtime-2.1`, voice `ash`, speed `0.92`, input transcription `gpt-4o-mini-transcribe`, semantic VAD with interruption enabled.
- The prompt explicitly acknowledges that text instructions cannot guarantee the underlying voice's accent, age or gravelly texture.
- `endpoints/generate-speech_POST.ts` and its schema preserve a separate generated-speech audition path using `gpt-4o-mini-tts`, voice `onyx`, speed `0.88`, with New York accent/voice direction. This is an audition path, not proof of a final selected voice.

### Guest memory, authentication and feedback
- `endpoints/memories_GET.ts`, `endpoints/memories_POST.ts`, `endpoints/memory-delete_POST.ts` and their schemas implement signed-in, per-user saved memories.
- Memory categories include taste preference, drink history, interaction style and personal context.
- Memories are explicitly saved by the user, associated with their account, supplied to the next session, and removable by the user.
- The Realtime endpoint loads up to 30 saved memories and up to 20 recent feedback signals for the signed-in user.
- `endpoints/feedback_POST.ts` and schema record signed-in user feedback and scored comedy audition details.
- Authentication source includes login, registration, logout, session and password-reset routes. Original source remains in the Voice Audition project.
- The source instructions prohibit pretending to remember information that has not actually been saved and supplied.

## Original project inventory

The complete original project includes:
- Main live conversation UI: `pages/_index.tsx`, `pages/_index.module.css`
- Comedy evaluation UI: `pages/comedy-lab.tsx`, `pages/comedy-lab.module.css`
- Login UI: `pages/login.tsx`, `pages/login.module.css`, `pages/login.pageLayout.tsx`
- Realtime, speech, feedback, memory and authentication endpoints plus request schemas
- Comedy intelligence and scenario libraries
- Auth/session/database/schema helpers, feedback/memory helpers, UI state helpers
- Private project instructions: `static/__dev/system-prompt.md`
- Research notes: `static/__dev/notes/comedy-research.md`
- Design principles: `static/__dev/design-principles.md`
- Dependency map: `static/__dev/dependencies.json`
- Project todos, scheduled-job metadata, database metadata and generated project history
- Floot-seeded shared UI component library and base styles
- Project-owned database and account/memory/feedback tables

The original Floot project is the authoritative location for the complete file tree and database state. The above source project was inspected read-only. No publish or production connection was performed.

## Working-copy source archive

The following original files were copied into this repository under `archive/marty-sullivan-original/`:
- `helpers/comedyIntelligence.tsx`
- `helpers/comedyScenarios.tsx`
- `endpoints/realtime-token_POST.ts`
- `endpoints/realtime-token_POST.schema.ts`
- `pages/_index.tsx`
- `pages/_index.module.css`
- `pages/comedy-lab.tsx`
- `pages/comedy-lab.module.css`
- `endpoints/generate-speech_POST.ts`
- `endpoints/generate-speech_POST.schema.ts`

The complete original project remains intact in Floot, including files not duplicated here. The original source copy is not a deployable Discover module without a deliberate integration and dependency/security review.

## Current implementation status — do not overstate

Recovered source contains a real Realtime WebRTC conversation prototype, a comedy lab, user-scoped memory routes and feedback routes. However:
- The existence of code does not establish that its external API credentials are currently configured or that a live voice session was successfully tested.
- The selected voice does not guarantee a Boston accent or gravelly older voice.
- The memory architecture in the prototype is user-scoped and explicit, but it must be reviewed and adapted to Discover's authentication and DEV data model before reuse.
- The comedy lab's feedback is human-scored; it is not autonomous model training.
- The original prototype is separate from the current Discover camera app.
- The current Discover in-app bartender is only a visual placeholder and is not yet connected to this Realtime engine.

## Integration plan

1. Freeze the original Voice Audition project as the untouched source of truth.
2. Build a versioned canonical character dossier for Marty Sullivan, reconciling New York source material with the chosen Boston identity.
3. Preserve the full original prompt and comedy engine, then create a new Boston-specific prompt as a derivative—not an overwrite.
4. Audit the Realtime endpoint, generated-speech audition path, memory endpoints, feedback storage, auth/session behavior, dependency list and database schema.
5. Adapt the backend to Harmony Discover DEV only. Never write to Harmony production.
6. Add voice selection/audition and transparent limitations; do not claim an accent is achieved until listened to and evaluated.
7. Bring the 33-scenario comedy lab and six-dimension rubric into a controlled evaluation workflow.
8. Integrate the bartender UI into Discover only after the voice engine, session handling, consent, memory isolation and failure states are validated.
9. Run type checks, tests and actual device/browser voice trials before any release.
10. No publishing or production deployment without explicit user approval.

## Source file copies

See the files in this directory. Original project ID and version above allow the full original project to be located without relying on this partial repository copy.
