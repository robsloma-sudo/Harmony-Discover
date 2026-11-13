export type BrowserBarcode = { rawValue: string; format: 'ean_13' | 'ean_8' | 'upc_a' };

const L: Record<string, string> = {
  '0001101':'0','0011001':'1','0010011':'2','0111101':'3','0100011':'4',
  '0110001':'5','0101111':'6','0111011':'7','0110111':'8','0001011':'9',
};
const G: Record<string, string> = {
  '0100111':'0','0110011':'1','0011011':'2','0100001':'3','0011101':'4',
  '0111001':'5','0000101':'6','0010001':'7','0001001':'8','0010111':'9',
};
const R: Record<string, string> = Object.fromEntries(Object.entries(L).map(([bits, digit]) => [bits.replace(/[01]/g, bit => bit === '0' ? '1' : '0'), digit]));
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

function checksumValid(digits: string, ean8 = false): boolean {
  if (!/^\\d+$/.test(digits) || digits.length !== (ean8 ? 8 : 13)) return false;
  const body = digits.slice(0, -1);
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (ean8 ? (index % 2 === 0 ? 3 : 1) : (index % 2 === 0 ? 1 : 3)), 0);
  return (10 - sum % 10) % 10 === Number(digits.at(-1));
}

/** Decode one already-resampled EAN bit sequence (one bit per module). */
export function decodeEanModules(bits: string): BrowserBarcode | null {
  if (bits.length === 95 && bits.startsWith('101') && bits.slice(45, 50) === '01010' && bits.endsWith('101')) {
    let left = '', parity = '';
    for (let i = 0; i < 6; i++) {
      const chunk = bits.slice(3 + i * 7, 10 + i * 7);
      if (L[chunk] !== undefined) { left += L[chunk]; parity += 'L'; }
      else if (G[chunk] !== undefined) { left += G[chunk]; parity += 'G'; }
      else return null;
    }
    const first = PARITY.indexOf(parity);
    if (first < 0) return null;
    let right = '';
    for (let i = 0; i < 6; i++) {
      const digit = R[bits.slice(50 + i * 7, 57 + i * 7)];
      if (digit === undefined) return null;
      right += digit;
    }
    const digits = String(first) + left + right;
    if (!checksumValid(digits)) return null;
    return { rawValue: digits, format: digits.startsWith('0') ? 'upc_a' : 'ean_13' };
  }
  if (bits.length === 67 && bits.startsWith('101') && bits.slice(31, 36) === '01010' && bits.endsWith('101')) {
    let left = '', right = '';
    for (let i = 0; i < 4; i++) {
      const digit = L[bits.slice(3 + i * 7, 10 + i * 7)];
      if (digit === undefined) return null;
      left += digit;
    }
    for (let i = 0; i < 4; i++) {
      const digit = R[bits.slice(36 + i * 7, 43 + i * 7)];
      if (digit === undefined) return null;
      right += digit;
    }
    const digits = left + right;
    if (!checksumValid(digits, true)) return null;
    return { rawValue: digits, format: 'ean_8' };
  }
  return null;
}

type Run = { bit: number; start: number; width: number };
function runsOf(bits: Uint8Array): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < bits.length;) {
    const bit = bits[i];
    let end = i + 1;
    while (end < bits.length && bits[end] === bit) end++;
    runs.push({ bit, start: i, width: end - i });
    i = end;
  }
  return runs;
}

function decodeLine(gray: Uint8Array): BrowserBarcode | null {
  let min = 255, max = 0;
  for (const value of gray) { if (value < min) min = value; if (value > max) max = value; }
  if (max - min < 35) return null;
  const threshold = (min + max) / 2;
  const bits = Uint8Array.from(gray, value => value < threshold ? 1 : 0);
  const runs = runsOf(bits);
  for (let i = 0; i + 2 < runs.length; i++) {
    const a = runs[i], b = runs[i + 1], c = runs[i + 2];
    if (a.bit !== 1 || b.bit !== 0 || c.bit !== 1) continue;
    const module = (a.width + b.width + c.width) / 3;
    if (module < 0.8 || Math.max(a.width, b.width, c.width) / Math.max(1, Math.min(a.width, b.width, c.width)) > 2.1) continue;
    for (const count of [95, 67]) {
      const sampled = new Array<string>(count);
      for (let bit = 0; bit < count; bit++) {
        const x = Math.round(a.start + (bit + 0.5) * module);
        sampled[bit] = bits[Math.min(bits.length - 1, x)] ? '1' : '0';
      }
      const result = decodeEanModules(sampled.join(''));
      if (result) return result;
    }
  }
  return null;
}

/**
 * iOS Safari does not consistently expose BarcodeDetector. This bounded
 * fallback reads EAN-13, UPC-A and EAN-8 directly from the captured frame.
 * It samples a small set of horizontal and vertical scan lines; it does not
 * upload another image or consume another API request.
 */
export function decodeEanFromCanvas(canvas: HTMLCanvasElement): BrowserBarcode[] {
  const width = canvas.width, height = canvas.height;
  if (width < 80 || height < 80) return [];
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  const image = context.getImageData(0, 0, width, height);
  const found = new Map<string, BrowserBarcode>();
  const sampleHorizontal = (y: number) => {
    const gray = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      gray[x] = Math.round(image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114);
    }
    return gray;
  };
  const sampleVertical = (x: number) => {
    const gray = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      const offset = (y * width + x) * 4;
      gray[y] = Math.round(image.data[offset] * 0.299 + image.data[offset + 1] * 0.587 + image.data[offset + 2] * 0.114);
    }
    return gray;
  };
  const add = (line: Uint8Array) => {
    const result = decodeLine(line);
    if (result) found.set(result.rawValue, result);
    const reverse = decodeLine(line.slice().reverse());
    if (reverse) found.set(reverse.rawValue, reverse);
  };
  for (let i = 0; i < 13; i++) add(sampleHorizontal(Math.round(height * (0.28 + i * 0.037))));
  for (let i = 0; i < 13; i++) add(sampleVertical(Math.round(width * (0.28 + i * 0.037))));
  return [...found.values()].slice(0, 8);
}
