# Iteration 27 — Netlify Expo Router dependency fix

## Evidence
The 2026-11-10 08:03 Netlify deploy log shows `expo export -p web` starts, then Metro fails resolving `query-string` imported by `expo-router/build/fork/getPathFromState.js`.

## Change
Added `query-string: ^7.1.3` as an explicit root dependency. This is a compatible CommonJS-capable release line for the Expo Router 4 dependency path and avoids relying on an undeclared/transitive package being hoisted into the app's module resolution path.

Iteration 26's `react-native-web: ~0.19.13`, `react-dom: 18.3.1`, and `build:web` script are retained.

## Netlify
- Build command: `npm run build:web` (or `npx expo export -p web`)
- Publish directory: `dist`
- Base directory: repository root / project root containing this `package.json`

## Verification status
- Source edit and ZIP packaging only.
- No dependency installation, lockfile generation, Expo export, or Netlify deployment performed.
- This addresses the exact missing-module error in the supplied log; another missing dependency or platform incompatibility may appear on the next build.
- No Supabase or production Harmony changes.
