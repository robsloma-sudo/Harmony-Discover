/* Browser-only relative depth worker. Model weights run locally after download. */
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

const MODEL = 'onnx-community/depth-anything-v2-small-ONNX';
let estimator = null;
let loading = false;
let queue = Promise.resolve();

async function load() {
  if (estimator) return estimator;
  if (loading) throw new Error('depth_model_loading');
  loading = true;
  try {
    const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
    estimator = await pipeline('depth-estimation', MODEL, {
      device: webgpu ? 'webgpu' : 'wasm',
      dtype: webgpu ? 'fp16' : 'q8',
    });
    return estimator;
  } finally { loading = false; }
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'dispose') { estimator = null; return; }
  if (message.type !== 'infer' || !(message.blob instanceof Blob)) return;
  queue = queue.then(async () => {
    const started = performance.now();
    try {
      self.postMessage({ type: 'status', status: 'loading' });
      const model = await load();
      const result = await model(message.blob);
      const tensor = result.predicted_depth;
      const raw = tensor.data;
      const dims = tensor.dims;
      const height = Number(dims[dims.length - 2]);
      const width = Number(dims[dims.length - 1]);
      if (!width || !height || raw.length < width * height) throw new Error('invalid_depth_output');
      const outWidth = 96;
      const outHeight = Math.max(1, Math.round(outWidth * height / width));
      const sampled = new Float32Array(outWidth * outHeight);
      let min = Infinity, max = -Infinity;
      for (let y = 0; y < outHeight; y++) {
        for (let x = 0; x < outWidth; x++) {
          const sx = Math.min(width - 1, Math.floor((x + .5) * width / outWidth));
          const sy = Math.min(height - 1, Math.floor((y + .5) * height / outHeight));
          const value = Number(raw[sy * width + sx]);
          const index = y * outWidth + x;
          sampled[index] = Number.isFinite(value) ? value : 0;
          if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
        }
      }
      const range = max - min;
      if (!Number.isFinite(range) || range < 1e-6) throw new Error('flat_depth_output');
      // Normalize to relative inverse depth. 1 is nearer, 0 is farther.
      for (let i = 0; i < sampled.length; i++) sampled[i] = Math.max(0, Math.min(1, (sampled[i] - min) / range));
      self.postMessage({
        type: 'depth',
        width: outWidth,
        height: outHeight,
        relative: true,
        values: sampled.buffer,
        inferenceMs: Math.round(performance.now() - started),
        model: MODEL,
      }, [sampled.buffer]);
    } catch (error) {
      self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'depth_inference_failed' });
    }
  }).catch(() => {});
};
