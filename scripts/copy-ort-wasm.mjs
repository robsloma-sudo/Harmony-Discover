import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve('node_modules/onnxruntime-web/dist');
const destination = path.resolve('public/ort');

await mkdir(destination, { recursive: true });
const files = (await readdir(source)).filter(file => file.endsWith('.wasm'));
if (files.length === 0) {
  throw new Error(`No ONNX Runtime Web WASM assets found in ${source}`);
}

for (const file of files) {
  await copyFile(path.join(source, file), path.join(destination, file));
}

// Metro cannot transform the dynamic-import expression embedded in the ESM
// entrypoint of onnxruntime-web 1.31.x. Serve its browser UMD bundle as a
// static asset and load it at runtime from the web camera path instead.
const browserRuntime = path.join(source, 'ort.min.js');
await copyFile(browserRuntime, path.join(destination, 'ort.min.js'));

console.log(`Copied ${files.length} ONNX Runtime Web WASM assets and the browser runtime to public/ort`);
