import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('public');
const bundlePath = path.resolve('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs');
if (!fs.existsSync(bundlePath)) throw new Error('ONNX Runtime WASM bundle is missing.');
const ort = await import(pathToFileURL(bundlePath).href);

let session;
try {
  // Node's ESM loader requires file: URLs for the WASM helper module. The
  // browser loader uses the same assets through the same-origin /ort/ path.
  ort.env.wasm.wasmPaths = pathToFileURL(path.resolve(root, 'ort') + path.sep).href;
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(
    fs.readFileSync(path.resolve(root, 'models/dfine_seg_n_coco.onnx')),
    { executionProviders: ['wasm'] },
  );
  const input = new ort.Tensor('float32', new Float32Array(3 * 640 * 640), [1, 3, 640, 640]);
  const output = await session.run({ input });
  const expected = {
    labels: [1, 300],
    boxes: [1, 300, 4],
    scores: [1, 300],
    masks: [1, 300, 160, 160],
  };
  for (const [name, dims] of Object.entries(expected)) {
    if (!output[name] || JSON.stringify(output[name].dims) !== JSON.stringify(dims)) {
      throw new Error('Unexpected ONNX Runtime WASM output shape for ' + name);
    }
  }
  console.log('D-FINE ONNX Runtime Web WASM smoke test passed:', JSON.stringify(expected));
} finally {
  if (session) await session.release();
}
