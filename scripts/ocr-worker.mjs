/*
 * Discover on-phone label text reader (PP-OCR, ONNX Runtime Web, CPU/WASM).
 *
 * Reads only the BIGGEST words on a label crop (brand names are the largest
 * print), fast enough to show "Probably Jameson" before the cloud label read
 * returns. It never names a bottle on its own: the page turns these words into
 * a guess with the letter catalogue, and the cloud read always wins.
 *
 * Models (Apache-2.0, PaddleOCR): PP-OCRv3 mobile text detector and the
 * PP-OCRv5 mobile English recogniser. Copied to /ort/ocr-worker.mjs by
 * scripts/copy-ort-wasm.mjs. Pure helpers are exported for unit tests; the
 * message handler only installs inside a worker.
 */

export const OCR_DEFAULTS = Object.freeze({
  detLongSide: 480,     // biggest words only: brand print is readable at this size
  detThreshold: 0.3,    // text-probability cut-off
  boxThreshold: 0.55,   // mean probability a word box needs
  unclip: 2.5,          // grows each box (the detector's boxes hug the letters)
  padX: 0.3,            // extra side room (first/last letters were clipped without it), x box height
  maxWords: 4,
  recHeight: 48,
  recMaxWidth: 480,
  minRecConfidence: 0.5,
});

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function bilinear(rgba, width, height, sx, sy, channel) {
  const x = Math.max(0, Math.min(width - 1, sx)), y = Math.max(0, Math.min(height - 1, sy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = rgba[(y0 * width + x0) * 4 + channel], b = rgba[(y0 * width + x1) * 4 + channel];
  const c = rgba[(y1 * width + x0) * 4 + channel], d = rgba[(y1 * width + x1) * 4 + channel];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Detector size: long side about `longSide`, both sides multiples of 32. */
export function detSize(width, height, longSide = OCR_DEFAULTS.detLongSide) {
  const scale = longSide / Math.max(width, height);
  return {
    width: Math.max(32, Math.round((width * scale) / 32) * 32),
    height: Math.max(32, Math.round((height * scale) / 32) * 32),
  };
}

/** RGBA -> detector input (1x3xHxW, ImageNet mean/std, RGB). */
export function detInput(rgba, width, height, longSide = OCR_DEFAULTS.detLongSide) {
  if (!(width >= 2) || !(height >= 2) || rgba.length !== width * height * 4) throw new Error('Invalid label crop for text reading.');
  const size = detSize(width, height, longSide);
  const plane = size.width * size.height;
  const data = new Float32Array(3 * plane);
  const scaleX = width / size.width, scaleY = height / size.height;
  for (let y = 0; y < size.height; y++) {
    const sy = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < size.width; x++) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const i = y * size.width + x;
      for (let c = 0; c < 3; c++) data[c * plane + i] = (bilinear(rgba, width, height, sx, sy, c) / 255 - MEAN[c]) / STD[c];
    }
  }
  return { data, ...size };
}

/**
 * Word boxes from the detector's probability map (connected regions above the
 * threshold), grown and mapped back to crop pixels. Axis-aligned: labels face
 * the camera, and the recogniser tolerates small tilts.
 */
export function boxesFromProbability(prob, mapWidth, mapHeight, width, height, options = {}) {
  const o = { ...OCR_DEFAULTS, ...options };
  const labels = new Int32Array(mapWidth * mapHeight);
  const stack = new Int32Array(mapWidth * mapHeight);
  const boxes = [];
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || !(prob[start] > o.detThreshold)) continue;
    next += 1;
    let top = 0, area = 0, sum = 0;
    let x0 = mapWidth, y0 = mapHeight, x1 = -1, y1 = -1;
    stack[top++] = start;
    labels[start] = next;
    while (top) {
      const p = stack[--top];
      const px = p % mapWidth, py = (p - px) / mapWidth;
      area += 1; sum += prob[p];
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= mapHeight) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if ((!dx && !dy) || nx < 0 || nx >= mapWidth) continue;
          const q = ny * mapWidth + nx;
          if (!labels[q] && prob[q] > o.detThreshold) { labels[q] = next; stack[top++] = q; }
        }
      }
    }
    const boxWidth = x1 - x0 + 1, boxHeight = y1 - y0 + 1;
    if (boxWidth < 4 || boxHeight < 4) continue;
    const score = sum / area;
    if (score < o.boxThreshold) continue;
    const grow = (area * o.unclip) / (2 * (boxWidth + boxHeight));
    const growX = grow + o.padX * boxHeight;
    const sx = width / mapWidth, sy = height / mapHeight;
    boxes.push({
      x0: Math.max(0, (x0 - growX) * sx),
      y0: Math.max(0, (y0 - grow) * sy),
      x1: Math.min(width, (x0 + boxWidth + growX) * sx),
      y1: Math.min(height, (y0 + boxHeight + grow) * sy),
      score,
    });
  }
  return boxes;
}

/** The biggest print first (brand names), by the box's short side. */
export function largestBoxes(boxes, count = OCR_DEFAULTS.maxWords) {
  return boxes.slice()
    .sort((a, b) => Math.min(b.y1 - b.y0, b.x1 - b.x0) - Math.min(a.y1 - a.y0, a.x1 - a.x0))
    .slice(0, count);
}

/** One word box -> recogniser input (1x3x48xW, (x/255-0.5)/0.5). Tall boxes (vertical print) are turned. */
export function recInput(rgba, width, height, box, options = {}) {
  const o = { ...OCR_DEFAULTS, ...options };
  const bx0 = Math.round(box.x0), by0 = Math.round(box.y0), bx1 = Math.round(box.x1), by1 = Math.round(box.y1);
  let w = bx1 - bx0, h = by1 - by0;
  if (w < 2 || h < 2) return null;
  const turned = h > w * 1.5;
  if (turned) [w, h] = [h, w];
  const outW = Math.min(o.recMaxWidth, Math.max(16, Math.ceil((o.recHeight * w) / h)));
  const outH = o.recHeight;
  const plane = outW * outH;
  const data = new Float32Array(3 * plane);
  const scaleX = w / outW, scaleY = h / outH;
  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) * scaleX - 0.5;
      // Turned 90 degrees anticlockwise: output (u, v) reads source (x1 - v, y0 + u).
      const sx = turned ? bx1 - 1 - v : bx0 + u;
      const sy = turned ? by0 + u : by0 + v;
      const i = y * outW + x;
      for (let c = 0; c < 3; c++) data[c * plane + i] = (bilinear(rgba, width, height, sx, sy, c) / 255 - 0.5) / 0.5;
    }
  }
  return { data, width: outW, height: outH };
}

/** Greedy CTC: best class per step, repeats merged, blanks (0) dropped. */
export function ctcDecode(logits, steps, classes, chars) {
  let text = '', last = 0, total = 0, kept = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, bestValue = -Infinity;
    const row = t * classes;
    for (let k = 0; k < classes; k++) if (logits[row + k] > bestValue) { bestValue = logits[row + k]; best = k; }
    if (best !== 0 && best !== last) { text += chars[best] ?? ''; total += bestValue; kept += 1; }
    last = best;
  }
  return { text, confidence: kept ? total / kept : 0 };
}

/** Recogniser classes: blank, the dictionary, then a space. */
export function recogniserChars(dictionaryText) {
  const lines = dictionaryText.split('\n').map(line => line.replace(/\r$/, ''));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return ['', ...lines, ' '];
}

/** A read worth passing on: confident enough, with at least two letters. */
export function keepWord(text, confidence, minimum = OCR_DEFAULTS.minRecConfidence) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  return confidence > minimum && letters >= 2;
}

/**
 * Bottles are round: print near the left and right edges of a bottle is squeezed (and often only partly
 * visible), so edge letters misread. `cylinder` is the bottle's centre and half-width in crop pixels.
 * This unrolls the label: each output column is the same distance along the bottle's surface, so the
 * squeezed edge letters get their real width back. Only the last sliver at the very edge is dropped
 * (cutting more lost the final letter in tests: 38 of 45 edge words read with unrolling at 0.999, 33 without).
 */
export function unrollCylinder(rgba, width, height, cylinder, maxSin = 0.999) {
  const r = cylinder.radius, cx = cylinder.centerX;
  if (!(r > 4)) return null;
  const left = Math.max(-maxSin, (0 - cx) / r), right = Math.min(maxSin, (width - 1 - cx) / r);
  if (!(right > left)) return null;
  const a0 = Math.asin(left), a1 = Math.asin(right);
  const outWidth = Math.max(2, Math.round(r * (a1 - a0)));
  const out = new Uint8ClampedArray(outWidth * height * 4);
  const sourceX = new Float32Array(outWidth);
  for (let x = 0; x < outWidth; x++) sourceX[x] = cx + r * Math.sin(a0 + ((x + 0.5) / outWidth) * (a1 - a0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < outWidth; x++) {
      const sx = sourceX[x], x0 = Math.max(0, Math.min(width - 1, Math.floor(sx)));
      const x1 = Math.min(width - 1, x0 + 1), f = Math.max(0, Math.min(1, sx - x0));
      const o = (y * outWidth + x) * 4, i0 = (y * width + x0) * 4, i1 = (y * width + x1) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = rgba[i0 + c] * (1 - f) + rgba[i1 + c] * f;
    }
  }
  /** Crop x -> unrolled x. */
  const toUnrolled = (x) => {
    const s = Math.max(left, Math.min(right, (x - cx) / r));
    return ((Math.asin(s) - a0) / (a1 - a0)) * outWidth;
  };
  return { rgba: out, width: outWidth, height, toUnrolled };
}

/** How far a box sits towards the bottle's edge (0 = centre, 1 = edge). */
export function edgeness(box, cylinder) {
  const r = cylinder.radius;
  return Math.max(Math.abs(box.x0 - cylinder.centerX), Math.abs(box.x1 - cylinder.centerX)) / r;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function installWorker(scope) {
  let ort = null, det = null, rec = null, chars = null;
  let queue = Promise.resolve();

  const fetchChecked = async (url, sha256) => {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Text reader file request failed (' + response.status + ').');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!crypto?.subtle) throw new Error('Secure SHA-256 verification is unavailable in this browser.');
    if ((await sha256Hex(bytes)) !== String(sha256).toLowerCase()) throw new Error('Text reader checksum mismatch; refusing to start.');
    return bytes;
  };

  const init = async (message) => {
    const [detBytes, recBytes, dictBytes] = await Promise.all([
      fetchChecked(message.detUrl, message.detSha256),
      fetchChecked(message.recUrl, message.recSha256),
      fetchChecked(message.dictUrl, message.dictSha256),
    ]);
    ort = await import('./ort.wasm.bundle.min.mjs');
    ort.env.wasm.wasmPaths = new URL('./', import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    det = await ort.InferenceSession.create(detBytes, options);
    rec = await ort.InferenceSession.create(recBytes, options);
    chars = recogniserChars(new TextDecoder().decode(dictBytes));
    return { classes: chars.length };
  };

  const read = async (message) => {
    if (!det || !rec) throw new Error('Text reader is not ready.');
    const started = performance.now();
    const rgba = new Uint8ClampedArray(message.buffer);
    const { width, height } = message;
    const input = detInput(rgba, width, height, message.detLongSide || OCR_DEFAULTS.detLongSide);
    const detTensor = new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]);
    const detOut = await det.run({ [det.inputNames[0]]: detTensor });
    detTensor.dispose?.();
    const probTensor = detOut[det.outputNames[0]];
    const boxes = largestBoxes(boxesFromProbability(probTensor.data, input.width, input.height, width, height), message.maxWords || OCR_DEFAULTS.maxWords);
    for (const value of Object.values(detOut)) value?.dispose?.();
    const detMs = performance.now() - started;
    const recognise = async (pixels, pixelWidth, pixelHeight, box) => {
      const prepared = recInput(pixels, pixelWidth, pixelHeight, box);
      if (!prepared) return null;
      const tensor = new ort.Tensor('float32', prepared.data, [1, 3, prepared.height, prepared.width]);
      const out = await rec.run({ [rec.inputNames[0]]: tensor });
      tensor.dispose?.();
      const logits = out[rec.outputNames[0]];
      const [, steps, classes] = logits.dims;
      const decoded = ctcDecode(logits.data, steps, classes, chars);
      for (const value of Object.values(out)) value?.dispose?.();
      return decoded;
    };
    // Round bottle: words towards the edge are read a second time from the unrolled label; the surer read wins.
    const cylinder = message.cylinder && message.cylinder.radius > 4 ? message.cylinder : null;
    let unrolled = null, unrolledReads = 0;
    const words = [];
    for (const box of boxes) {
      let decoded = await recognise(rgba, width, height, box);
      if (cylinder && edgeness(box, cylinder) > 0.45) {
        unrolled = unrolled || unrollCylinder(rgba, width, height, cylinder);
        if (unrolled) {
          const flat = { x0: unrolled.toUnrolled(box.x0), x1: unrolled.toUnrolled(box.x1), y0: box.y0, y1: box.y1 };
          const second = await recognise(unrolled.rgba, unrolled.width, unrolled.height, flat);
          unrolledReads += 1;
          if (second && (!decoded || second.confidence > decoded.confidence)) decoded = second;
        }
      }
      if (decoded && keepWord(decoded.text, decoded.confidence)) {
        // Runs into the crop's side or the bottle's curved edge: letters may be missing (a part-word).
        const edge = box.x0 <= 2 || box.x1 >= width - 2 || (!!cylinder && edgeness(box, cylinder) > 0.75);
        words.push({ text: decoded.text.trim(), confidence: decoded.confidence, height: Math.round(box.y1 - box.y0), edge });
      }
    }
    return { words, detMs, unrolledReads, totalMs: performance.now() - started };
  };

  scope.onmessage = (event) => {
    const message = event.data || {};
    queue = queue.then(async () => {
      try {
        if (message.type === 'init') scope.postMessage({ type: 'ready', id: message.id, ...(await init(message)) });
        else if (message.type === 'read') scope.postMessage({ type: 'result', id: message.id, ...(await read(message)) });
        else if (message.type === 'dispose') {
          await det?.release?.(); await rec?.release?.();
          det = null; rec = null;
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
