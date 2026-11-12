import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const root = path.resolve('public');
const bundlePath = path.resolve('node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs');
if (!fs.existsSync(bundlePath)) throw new Error('ONNX Runtime WASM bundle is missing.');
const ort = await import(pathToFileURL(bundlePath).href);

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  response.end(fs.readFileSync(file));
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local asset server failed to start.');

let session;
try {
  ort.env.wasm.wasmPaths = 'http://127.0.0.1:' + address.port + '/ort/';
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
  console.log('D-FINE ONNX Runtime Web WASM smoke test passed:', JSON.stringify(
    Object.fromEntries(Object.entries(expected).map(([name, dims]) => [name, dims])),
  ));
} finally {
  if (session) await session.release();
  await new Promise(resolve => server.close(resolve));
}
