import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const functionRoot = resolve(root, 'supabase/functions/discover-api');
const sharedRoot = resolve(functionRoot, '_shared');

await rm(sharedRoot, { recursive: true, force: true });
await mkdir(resolve(sharedRoot, 'apps/api'), { recursive: true });
await mkdir(resolve(sharedRoot, 'apps/edge'), { recursive: true });

await cp(resolve(root, 'apps/api/src'), resolve(sharedRoot, 'apps/api/src'), { recursive: true });
await cp(resolve(root, 'apps/edge'), resolve(sharedRoot, 'apps/edge'), { recursive: true });
await cp(resolve(root, 'packages'), resolve(sharedRoot, 'packages'), { recursive: true });
await cp(resolve(root, 'src'), resolve(sharedRoot, 'src'), { recursive: true });

console.log('Built self-contained Discover API Edge Function source at supabase/functions/discover-api');

// discover-checkins: the small check-in function (same shared sources, its own entry point).
const checkinsRoot = resolve(root, 'supabase/functions/discover-checkins');
const checkinsShared = resolve(checkinsRoot, '_shared');
await rm(checkinsShared, { recursive: true, force: true });
await mkdir(resolve(checkinsShared, 'apps/api/src/core'), { recursive: true });
await mkdir(resolve(checkinsShared, 'apps/edge'), { recursive: true });
await mkdir(resolve(checkinsShared, 'src/services'), { recursive: true });
for (const f of ['http.ts', 'checkins.ts', 'client.ts', 'environment.ts', 'identity.ts', 'limiter.ts']) {
  await cp(resolve(root, 'apps/api/src/core', f), resolve(checkinsShared, 'apps/api/src/core', f));
}
for (const f of ['checkins-router.ts', 'discover-checkins.ts']) await cp(resolve(root, 'apps/edge', f), resolve(checkinsShared, 'apps/edge', f));
for (const f of ['venueCheckin.ts', 'phgAtlasRecords.ts']) await cp(resolve(root, 'src/services', f), resolve(checkinsShared, 'src/services', f));
console.log('Built Discover check-ins Edge Function source at supabase/functions/discover-checkins');
