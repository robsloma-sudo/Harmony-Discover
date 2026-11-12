import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');
const required = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

if (!fs.existsSync(source)) {
  throw new Error('ONNX Runtime Web distribution was not found. Install locked dependencies first.');
}

const missing = required.filter(file => !fs.existsSync(path.join(source, file)));
if (missing.length) {
  throw new Error('Required ONNX Runtime Web WASM assets are missing: ' + missing.join(', '));
}

fs.mkdirSync(destination, { recursive: true });
for (const file of required) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}

console.log('Copied the minimal ONNX Runtime Web WASM assets to public/ort:', required.join(', '));
