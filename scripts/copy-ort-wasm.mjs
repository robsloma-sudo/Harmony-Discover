import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');
const required = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort.wasm.bundle.min.mjs',
  // WebGPU build used by the detector worker when the GPU passes its check.
  'ort.webgpu.bundle.min.mjs',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];
const missing = required.filter(file => !fs.existsSync(path.join(source, file)));
if (missing.length) {
  throw new Error('Required ONNX Runtime Web assets are missing: ' + missing.join(', '));
}
const loaderSource = path.resolve('scripts/ort-loader.js');
if (!fs.existsSync(loaderSource)) throw new Error('Standalone ONNX Runtime browser loader is missing.');
const workerSource = path.resolve('scripts/dfine-worker.mjs');
if (!fs.existsSync(workerSource)) throw new Error('Bottle detector worker is missing.');

fs.mkdirSync(destination, { recursive: true });
for (const file of required) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
fs.copyFileSync(loaderSource, path.join(destination, 'ort-loader.js'));
fs.copyFileSync(workerSource, path.join(destination, 'dfine-worker.mjs'));

console.log('Copied ONNX Runtime Web assets, standalone loader and detector worker to public/ort.');
