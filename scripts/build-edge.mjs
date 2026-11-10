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
