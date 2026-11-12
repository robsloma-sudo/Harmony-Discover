import * as ort from 'onnxruntime-web';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const modelPath = path.resolve('public/models/dfine_seg_n_coco.onnx');
const wasmPath = path.resolve('node_modules/onnxruntime-web/dist') + path.sep;
const model = new Uint8Array(await readFile(modelPath));

ort.env.wasm.wasmPaths = wasmPath;
ort.env.wasm.numThreads = 1;

const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
try {
  const input = new ort.Tensor('float32', new Float32Array(3 * 640 * 640), [1, 3, 640, 640]);
  const output = await session.run({ [session.inputNames[0]]: input });
  const expected = ['labels', 'boxes', 'scores', 'masks'];
  if (expected.some(name => !session.outputNames.includes(name))) {
    throw new Error('Unexpected WASM output names: ' + session.outputNames.join(', '));
  }
  const labels = output.labels, boxes = output.boxes, scores = output.scores, masks = output.masks;
  if (!labels || !boxes || !scores || !masks) throw new Error('Missing D-FINE output tensor.');
  if (labels.dims.length !== 2 || boxes.dims.length !== 3 || scores.dims.length !== 2 || masks.dims.length !== 4) {
    throw new Error('Unexpected D-FINE output tensor rank.');
  }
  const count = labels.dims[1];
  if (labels.dims[0] !== 1 || boxes.dims[0] !== 1 || boxes.dims[1] !== count ||
      boxes.dims[2] !== 4 || scores.dims[0] !== 1 || scores.dims[1] !== count ||
      masks.dims[0] !== 1 || masks.dims[1] !== count ||
      labels.data.length !== count || boxes.data.length !== count * 4 ||
      scores.data.length !== count || masks.data.length !== count * masks.dims[2] * masks.dims[3]) {
    throw new Error('D-FINE WASM output dimensions do not match the exported graph contract.');
  }
  console.log(JSON.stringify({
    provider: 'wasm',
    model: path.basename(modelPath),
    input: { name: session.inputNames[0], dims: input.dims },
    outputs: expected.map(name => ({ name, dims: output[name].dims, type: output[name].type })),
    status: 'passed',
  }, null, 2));
} finally {
  await session.release();
}
