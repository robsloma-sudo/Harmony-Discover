import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');

await mkdir(destination, { recursive: true });
const files = (await readdir(source)).filter(file => file.endsWith('.wasm') || file.endsWith('.mjs'));
if (!files.some(file => file.endsWith('.wasm')) || !files.some(file => file.endsWith('.mjs'))) {
  throw new Error(`ONNX Runtime Web WASM or JavaScript glue assets are missing in ${source}`);
}

for (const file of files) {
  await copyFile(path.join(source, file), path.join(destination, file));
}

console.log(`Copied ${files.length} ONNX Runtime Web WASM/glue assets to public/ort`);
