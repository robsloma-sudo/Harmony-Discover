import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const functionRoot = resolve(root, 'supabase/functions/discover-api');
const sharedRoot = resolve(functionRoot, '_shared');

await rm(sharedRoot, { recursive: true, force: true });
await mkdir(sharedRoot, { recursive: true });

for (const directory of ['apps', 'packages', 'src']) {
  await cp(resolve(root, directory), resolve(sharedRoot, directory), { recursive: true });
}

console.log('Built self-contained Discover API Edge Function source at supabase/functions/discover-api');
