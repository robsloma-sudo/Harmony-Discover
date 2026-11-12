import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');
const required = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort.wasm.bundle.min.mjs',
];
const missing = required.filter(file => !fs.existsSync(path.join(source, file)));
if (missing.length) {
  throw new Error('Required ONNX Runtime Web assets are missing: ' + missing.join(', '));
}
const loaderSource = path.resolve('scripts/ort-loader.js');
if (!fs.existsSync(loaderSource)) throw new Error('Standalone ONNX Runtime browser loader is missing.');

fs.mkdirSync(destination, { recursive: true });
for (const file of required) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
fs.copyFileSync(loaderSource, path.join(destination, 'ort-loader.js'));

console.log('Copied minimal ONNX Runtime Web assets and standalone loader to public/ort.');
