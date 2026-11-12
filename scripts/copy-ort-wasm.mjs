import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');

await mkdir(destination, { recursive: true });
const files = await readdir(source);
const required = files.filter(file =>
  file === 'ort.min.js' ||
  (/^ort-wasm.*\.(wasm|mjs)$/.test(file))
);
if (!required.includes('ort.min.js') ||
    !required.some(file => file.endsWith('.wasm')) ||
    !required.some(file => file.endsWith('.mjs'))) {
  throw new Error('ONNX Runtime Web browser bundle or WASM loader assets are missing from ' + source);
}

for (const file of required) {
  await copyFile(path.join(source, file), path.join(destination, file));
}

console.log('Copied ONNX Runtime UMD browser bundle and ' +
  required.filter(file => file.startsWith('ort-wasm')).length +
  ' WASM loader assets to public/ort');
