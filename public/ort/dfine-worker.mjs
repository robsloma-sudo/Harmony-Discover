/*
 * Discover local bottle detector worker (D-FINE-seg, ONNX Runtime Web).
 *
 * Runs model inference off the camera/UI thread so boxes keep moving smoothly
 * while the detector works. A worker is started for one backend: 'wasm', or
 * 'webgpu' (a trial that first checks the GPU gives the same numbers as the
 * CPU path and reports how fast it is).
 *
 * Copied to /ort/dfine-worker.mjs by scripts/copy-ort-wasm.mjs. Pure helpers
 * are exported for unit tests; the message handler only installs inside a
 * worker.
 */

export const DFINE_INPUT_SIZE = 640;

/** Same bilinear RGB resize + NCHW 0..1 normalization as preprocessDfineImage. */
export function preprocessRgba(rgba, width, height, size = DFINE_INPUT_SIZE) {
  if (!(width >= 2) || !(height >= 2) || rgba.length !== width * height * 4) {
    throw new Error('Invalid camera frame for D-FINE preprocessing.');
  }
  const output = new Float32Array(3 * size * size);
  const plane = size * size;
  const scaleY = height / size, scaleX = width / size;
  const xs0 = new Int32Array(size), xs1 = new Int32Array(size), fxs = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    const sourceX = Math.max(0, Math.min(width - 1, (x + 0.5) * scaleX - 0.5));
    const x0 = Math.floor(sourceX);
    xs0[x] = x0 * 4;
    xs1[x] = Math.min(width - 1, x0 + 1) * 4;
    fxs[x] = sourceX - x0;
  }
  for (let y = 0; y < size; y++) {
    const sourceY = Math.max(0, Math.min(height - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sourceY - y0;
    const row0 = y0 * width * 4, row1 = y1 * width * 4;
    for (let x = 0; x < size; x++) {
      const fx = fxs[x];
      const p00 = row0 + xs0[x], p01 = row0 + xs1[x], p10 = row1 + xs0[x], p11 = row1 + xs1[x];
      const target = y * size + x;
      for (let channel = 0; channel < 3; channel++) {
        const top = rgba[p00 + channel] * (1 - fx) + rgba[p01 + channel] * fx;
        const bottom = rgba[p10 + channel] * (1 - fx) + rgba[p11 + channel] * fx;
        output[channel * plane + target] = (top * (1 - fy) + bottom * fy) / 255;
      }
    }
  }
  return output;
}

/** Indices of queries worth sending back: allowed classes at or above the score floor. */
export function selectDetections(labels, scores, classIds, minimumScore) {
  const allowed = new Set(classIds);
  const indices = [];
  for (let i = 0; i < scores.length; i++) {
    const score = Number(scores[i]);
    if (allowed.has(Number(labels[i])) && Number.isFinite(score) && score >= minimumScore) indices.push(i);
  }
  return indices;
}

/** Packs only the selected queries (and their masks) into compact transferable arrays. */
export function packDetections(indices, labels, boxes, scores, masks, maskSize) {
  const count = indices.length;
  const packed = {
    count,
    labels: new Int32Array(count),
    boxes: new Float32Array(count * 4),
    scores: new Float32Array(count),
    masks: new Float32Array(count * maskSize),
  };
  indices.forEach((index, k) => {
    packed.labels[k] = Number(labels[index]);
    packed.scores[k] = Number(scores[index]);
    for (let i = 0; i < 4; i++) packed.boxes[k * 4 + i] = Number(boxes[index * 4 + i]);
    packed.masks.set(masks.subarray(index * maskSize, (index + 1) * maskSize), k * maskSize);
  });
  return packed;
}

/** Deterministic input used to check that an accelerated backend computes correct numbers. */
export function validationInput(size = DFINE_INPUT_SIZE) {
  const data = new Float32Array(3 * size * size);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 2654435761) % 1000) / 1000;
  return data;
}

/** CPU (WASM / native ONNX Runtime) outputs for validationInput(). */
export const VALIDATION_REFERENCE = Object.freeze({
  labels: [6, 6, 6],
  scores: [0.025407, 0.025384, 0.024472, 0.02438, 0.023175],
  boxes: [427.275, 133.12, 640.0, 269.031, 364.86, 128.851, 640.0, 283.097],
  mask0Center: 0.718185,
  mask0Mean: 0.686648,
});

/** True when outputs agree with the CPU reference closely enough to trust. */
export function matchesValidationReference(output, reference = VALIDATION_REFERENCE) {
  const labels = Array.from(output.labels.slice(0, reference.labels.length), Number);
  if (labels.some((label, i) => label !== reference.labels[i])) return false;
  for (let i = 0; i < reference.scores.length; i++) {
    if (!(Math.abs(Number(output.scores[i]) - reference.scores[i]) <= 0.006)) return false;
  }
  for (let i = 0; i < reference.boxes.length; i++) {
    if (!(Math.abs(Number(output.boxes[i]) - reference.boxes[i]) <= 6)) return false;
  }
  const maskSize = output.maskSize;
  const side = Math.round(Math.sqrt(maskSize));
  const center = Number(output.masks[(side >> 1) * side + (side >> 1)]);
  if (!(Math.abs(center - reference.mask0Center) <= 0.05)) return false;
  let sum = 0;
  for (let i = 0; i < maskSize; i++) sum += Number(output.masks[i]);
  return Math.abs(sum / maskSize - reference.mask0Mean) <= 0.04;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function installWorker(scope) {
  let ort = null;
  let session = null;
  let backend = null;
  let queue = Promise.resolve();

  // Boxes only: the mask head is skipped (about 15% faster, and no 30 MB mask
  // tensor to copy each frame). The web scanner draws boxes, not outlines.
  const BOX_OUTPUTS = ['labels', 'boxes', 'scores'];
  const runSession = async (input, fetches) => {
    const tensor = new ort.Tensor('float32', input, [1, 3, DFINE_INPUT_SIZE, DFINE_INPUT_SIZE]);
    const outputs = fetches ? await session.run({ [session.inputNames[0]]: tensor }, fetches) : await session.run({ [session.inputNames[0]]: tensor });
    tensor.dispose?.();
    return outputs;
  };

  const releaseOutputs = (outputs) => {
    for (const value of Object.values(outputs || {})) value?.dispose?.();
  };

  const createSession = async (kind, modelBytes) => {
    ort = await import(kind === 'webgpu' ? './ort.webgpu.bundle.min.mjs' : './ort.wasm.bundle.min.mjs');
    ort.env.wasm.wasmPaths = new URL('./', import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: kind === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      graphOptimizationLevel: 'all',
    });
    backend = kind;
  };

  const init = async (message) => {
    const response = await fetch(message.modelUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error('D-FINE model request failed (' + response.status + ').');
    const modelBytes = new Uint8Array(await response.arrayBuffer());
    if (!crypto?.subtle) throw new Error('Secure SHA-256 verification is unavailable in this browser.');
    if ((await sha256Hex(modelBytes)) !== String(message.sha256).toLowerCase()) {
      throw new Error('D-FINE model checksum mismatch; refusing to initialize inference.');
    }
    if (message.backend === 'webgpu') {
      try {
        if (!scope.navigator?.gpu || !(await scope.navigator.gpu.requestAdapter())) throw new Error('No WebGPU adapter.');
        await createSession('webgpu', modelBytes);
        const started = performance.now();
        const outputs = await runSession(validationInput());
        const firstMs = performance.now() - started;
        const maskSize = outputs.masks.dims[2] * outputs.masks.dims[3];
        const ok = matchesValidationReference({
          labels: outputs.labels.data, scores: outputs.scores.data, boxes: outputs.boxes.data,
          masks: outputs.masks.data, maskSize,
        });
        releaseOutputs(outputs);
        const warmStarted = performance.now();
        releaseOutputs(await runSession(validationInput(), BOX_OUTPUTS));
        const warmMs = performance.now() - warmStarted;
        if (!ok) throw new Error('WebGPU results did not match the CPU reference.');
        return { backend: 'webgpu', firstMs, warmMs };
      } catch (error) {
        // Never mix two ONNX Runtime builds in one worker; the page keeps its WASM worker.
        await session?.release?.();
        session = null;
        return { fallback: true, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    await createSession('wasm', modelBytes);
    // First run allocates; the second is the steady-state time the GPU must beat.
    releaseOutputs(await runSession(validationInput(), BOX_OUTPUTS));
    const started = performance.now();
    releaseOutputs(await runSession(validationInput(), BOX_OUTPUTS));
    return { backend: 'wasm', warmMs: performance.now() - started };
  };

  const infer = async (message) => {
    if (!session) throw new Error('D-FINE session is not ready.');
    const startedAt = performance.now();
    const rgba = new Uint8ClampedArray(message.buffer);
    const input = preprocessRgba(rgba, message.width, message.height);
    const preprocessMs = performance.now() - startedAt;
    const outputs = await runSession(input, message.withMasks ? undefined : BOX_OUTPUTS);
    const inferenceMs = performance.now() - startedAt - preprocessMs;
    const { labels, boxes, scores, masks } = outputs;
    const maskHeight = masks ? masks.dims[2] : 0, maskWidth = masks ? masks.dims[3] : 0;
    const indices = selectDetections(labels.data, scores.data, message.classIds, message.minimumScore);
    const packed = packDetections(indices, labels.data, boxes.data, scores.data, masks ? masks.data : new Float32Array(0), maskWidth * maskHeight);
    releaseOutputs(outputs);
    return { ...packed, maskWidth, maskHeight, inputSize: DFINE_INPUT_SIZE, preprocessMs, inferenceMs, backend };
  };

  scope.onmessage = (event) => {
    const message = event.data || {};
    queue = queue.then(async () => {
      try {
        if (message.type === 'init') {
          const result = await init(message);
          scope.postMessage({ type: result.fallback ? 'fallback' : 'ready', id: message.id, ...result });
        } else if (message.type === 'infer') {
          const result = await infer(message);
          scope.postMessage({ type: 'result', id: message.id, ...result },
            [result.labels.buffer, result.boxes.buffer, result.scores.buffer, result.masks.buffer]);
        } else if (message.type === 'dispose') {
          await session?.release?.();
          session = null;
          scope.close?.();
        }
      } catch (error) {
        scope.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) });
      }
    });
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  installWorker(self);
}
