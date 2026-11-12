import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { router } from 'expo-router';
import { readLiveFrame, saveBottleSightings, bottleErrorMessage, type BottleRead, type MenuGlimpse } from '../services/discoverLiveApi';
import { useScan } from '../state/ScanContext';

// One scanner for everything: bottles (beer, wine, spirits) and menus. Browser tier.
// It is not a page: the home screen swaps it in once a photo is taken (or up to six are chosen from the library).
// Each photo freezes on the screen and gets its own scanner.
// Results panels use a compact single-line data grid over a translucent glass surface.

const GLOW = '0 1px 2px rgba(0,10,40,.8),0 0 6px #4f8bff,0 0 14px #2b56f0,0 0 28px #1d3fd8';
const AMBER_GLOW = '0 1px 2px rgba(40,20,0,.8),0 0 8px rgba(255,200,90,.6)';
const OK_GLOW = '0 0 8px rgba(70,255,160,.55)';
const word: CSSProperties = { color: '#f2f8ff', textShadow: GLOW, fontWeight: 700, fontFamily: "'Space Grotesk',system-ui,-apple-system,sans-serif", letterSpacing: 0.2 };
const dim: CSSProperties = { ...word, color: '#d3e3ff', fontWeight: 500 };
const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };
const EDGE_LONG = 420, SEND_LONG = 1100, SWEEP_MS = 2300, MAX_PHOTOS = 6;

const CATEGORY: Record<string, string> = { tequila: 'Tequila', mezcal: 'Mezcal', whiskey: 'Whiskey', vodka: 'Vodka', gin: 'Gin', rum: 'Rum', brandy: 'Brandy', liqueur: 'Liqueur', amaro_aperitivo: 'Amaro / aperitivo', vermouth: 'Vermouth', wine: 'Wine', sparkling: 'Sparkling wine', beer: 'Beer', cider: 'Cider', non_alcoholic: 'Non-alcoholic', other: '' };
const nameOf = (b: BottleRead) => [b.match?.brand || b.brand, b.product].filter(Boolean).join(' ');
const keyOf = (b: BottleRead) => nameOf(b).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v || ''));

/** The facts worth showing for one bottle, most important first. Only what was printed on the label. */
function factsOf(b: BottleRead): Array<[string, string]> {
  const d=b.details||{}, fc=b.fieldConfidence||{};
  const rows: Array<[string,string]> = [
    ['Brand',b.match?.brand||b.brand],['Producer',text(d.producer)],['Distillery',text(d.distillery)],['Winery / estate',text(d.winery)||text(d.estate)],
    ['Bottler',text(d.bottler)],['Brand owner',text(d.brand_owner)],['Product expression',b.product],['Category',CATEGORY[b.category]||b.category],
    ['Class / designation',text(d.classification)||text(d.label_designation)],['Style',text(d.style)],['Subcategory',text(d.subcategory)],
    ['Origin',b.origin||text(d.country)],['Region',text(d.region)],['Subregion / AVA',text(d.subregion)],['Appellation',text(d.appellation)],['Appellation level',text(d.appellation_level)],
    ['Vineyard',text(d.vineyard)],['Grapes',text(d.grapes)],['Vintage',text(d.vintage)],['Harvest',text(d.harvested_on)],
    ['Proof / ABV',b.proof],['Bottle size',b.size||text(d.net_contents)||text(d.package_size)],['Package type',text(d.package_type)],['Package material',text(d.package_material)],
    ['SKU',text(d.sku)],['UPC / EAN',text(d.upc_ean)],['Age statement',text(d.age_statement)],['Mash bill',text(d.mash_bill)],['Grain',text(d.grain)],['Agave',text(d.agave_type)],
    ['Production method',text(d.production_method)],['Distillation',text(d.distillation)],['Cask type',text(d.cask_type)],['Cask finish',text(d.cask_finish)],
    ['Barrel number',text(d.barrel_number)],['Batch',text(d.batch)],['Lot code',text(d.lot_code)],['Distilled on',text(d.distilled_on)],['Bottled on',text(d.bottled_on)],
    ['Disgorged on',text(d.disgorged_on)],['Dosage',text(d.dosage)],['Residual sugar',text(d.residual_sugar)],['Flavor',text(d.flavor)],
    ['Importer',text(d.importer)],['Certifications',text(d.certifications)],['Organic claim',text(d.organic_claim)],['Awards',text(d.awards)],
  ];
  const seen=new Set<string>();
  const aliases:Record<string,string>={brand:'brand','product expression':'product',category:'category','class / designation':'classification','proof / abv':'proof','bottle size':'size',origin:'origin','winery / estate':'winery', 'subregion / ava':'subregion','appellation level':'appellation_level','age statement':'age_statement','cask finish':'cask_finish','barrel number':'barrel_number','lot code':'lot_code','organic claim':'organic_claim','upc / ean':'upc_ean'};
  return rows.filter(([label,value])=>{const key=label.toLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;}).map(([label,value])=>{const field=aliases[label.toLowerCase()]||label.toLowerCase().replace(/[^a-z0-9]+/g,'_');const score=fc[field];return [score===undefined?label:`${label} · ${Math.round(score*100)}%`,value] as [string,string];});
}
const RESEARCH_GROUPS: Array<{ title: string; fields: Array<[string, string]> }> = [
  { title: 'Identity & SKU', fields: [['Exact expression','product'],['SKU','sku'],['UPC / EAN','upc_ean'],['Package variant','package_type']] },
  { title: 'Producer & origin', fields: [['Producer','producer'],['Distillery / winery / brewery','distillery'],['Brand owner','brand_owner'],['Country & region','region'],['Appellation','appellation']] },
  { title: 'Production', fields: [['Ingredients / grapes / agave','grapes'],['Mash bill','mash_bill'],['Production method','production_method'],['Distillation','distillation']] },
  { title: 'Ageing & release', fields: [['Age statement','age_statement'],['Barrel / cask','cask_type'],['Cask finish','cask_finish'],['Vintage / batch','vintage']] },
  { title: 'Specifications', fields: [['Proof / ABV','proof'],['Bottle size','size'],['Dosage / residual sugar','dosage'],['Certifications','certifications']] },
  { title: 'Tasting & provenance', fields: [['Tasting profile','tasting_notes'],['Aroma / palate / finish','aroma'],['Awards','awards'],['Producer history','founding_year']] },
];
function researchValue(b: BottleRead, key: string): string {
  const d = b.details || {};
  const aliases: Record<string, unknown> = { product: b.product, proof: b.proof, size: b.size, region: d.region || d.subregion || d.country, distillery: d.distillery || d.winery || d.brewery || d.producer, grapes: d.grapes || d.agave_type || d.ingredients, vintage: d.vintage || d.batch };
  const value = aliases[key] ?? d[key];
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}
async function makeFinePrintCrop(uri: string, box: BottleRead['label_box']): Promise<string | null> {
  if (!box) return null;
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('label_crop_load_failed')); image.src = uri; });
  const padX = (box.x1 - box.x0) * 0.06, padY = (box.y1 - box.y0) * 0.08;
  const x0 = Math.max(0, box.x0 - padX), y0 = Math.max(0, box.y0 - padY);
  const x1 = Math.min(1, box.x1 + padX), y1 = Math.min(1, box.y1 + padY);
  const sx = Math.round(x0 * image.naturalWidth), sy = Math.round(y0 * image.naturalHeight);
  const sw = Math.max(1, Math.round((x1 - x0) * image.naturalWidth)), sh = Math.max(1, Math.round((y1 - y0) * image.naturalHeight));
  const scale = Math.min(2.5, 1600 / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] || '';
}

// Share a small fine-print request pool across every photo in this scanner session.
// A per-photo cap alone could still burst to 12 requests when six images are scanned.
let activeFinePrintReads = 0;
const finePrintWaiters: Array<() => void> = [];
async function withFinePrintSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeFinePrintReads >= 2) await new Promise<void>(resolve => finePrintWaiters.push(resolve));
  activeFinePrintReads += 1;
  try {
    return await task();
  } finally {
    activeFinePrintReads = Math.max(0, activeFinePrintReads - 1);
    finePrintWaiters.shift()?.();
  }
}

type EnhancementVariant = { name: string; jpeg: string; score: number };

/**
 * Browser restoration stage. Every output is a derivative of the immutable source crop.
 * These are evidence-preserving visibility transforms, not generative super-resolution:
 * they must never be treated as proof of a character that is absent from the source.
 */
async function makeFinePrintVariants(base64: string): Promise<EnhancementVariant[]> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('enhancement_image_load_failed'));
    image.src = `data:image/jpeg;base64,${base64}`;
  });
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 4_000_000) return [{ name: 'original', jpeg: base64, score: 0 }];
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width; sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return [{ name: 'original', jpeg: base64, score: 0 }];
  sourceContext.drawImage(image, 0, 0);
  const original = sourceContext.getImageData(0, 0, width, height);
  const src = original.data;
  const count = width * height;
  const luminance = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) luminance[i] = 0.2126 * src[p] + 0.7152 * src[p + 1] + 0.0722 * src[p + 2];

  // Estimate illumination at a wider scale. The blurred field is used only to
  // separate slow lighting changes from local ink/edge detail.
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = width; blurCanvas.height = height;
  const blurContext = blurCanvas.getContext('2d', { willReadFrequently: true });
  let localLight = luminance;
  if (blurContext) {
    blurContext.filter = `blur(${Math.max(3, Math.round(Math.min(width, height) * 0.035))}px)`;
    blurContext.drawImage(sourceCanvas, 0, 0);
    blurContext.filter = 'none';
    const blurred = blurContext.getImageData(0, 0, width, height).data;
    localLight = new Float32Array(count);
    for (let i = 0, p = 0; i < count; i++, p += 4) localLight[i] = 0.2126 * blurred[p] + 0.7152 * blurred[p + 1] + 0.0722 * blurred[p + 2];
  }

  const variants: EnhancementVariant[] = [{ name: 'original', jpeg: base64, score: 0 }];
  const render = (name: string, transform: (r: number, g: number, b: number, y: number, i: number) => [number, number, number]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const frame = context.createImageData(width, height), dst = frame.data;
    let clipped = 0;
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const rgb = transform(src[p], src[p + 1], src[p + 2], luminance[i], i);
      const r = Math.max(0, Math.min(255, rgb[0]));
      const g = Math.max(0, Math.min(255, rgb[1]));
      const b = Math.max(0, Math.min(255, rgb[2]));
      dst[p] = r; dst[p + 1] = g; dst[p + 2] = b; dst[p + 3] = src[p + 3];
      if (r < 2 || r > 253 || g < 2 || g > 253 || b < 2 || b > 253) clipped++;
    }
    context.putImageData(frame, 0, 0);
    const output = context.getImageData(0, 0, width, height).data;
    // OCR-oriented proxy: reward compact, stroke-like gradients and penalize
    // saturation/clipping. It is a ranking heuristic, not a readability claim.
    let gradient = 0, coherent = 0, samples = 0;
    const yAt = (x: number, y: number) => {
      const p = (y * width + x) * 4;
      return 0.2126 * output[p] + 0.7152 * output[p + 1] + 0.0722 * output[p + 2];
    };
    for (let y = 1; y < height - 1; y += 2) for (let x = 1; x < width - 1; x += 2) {
      const gx = yAt(x + 1, y) - yAt(x - 1, y);
      const gy = yAt(x, y + 1) - yAt(x, y - 1);
      const magnitude = Math.hypot(gx, gy);
      if (magnitude > 18 && magnitude < 210) { gradient += Math.min(100, magnitude); coherent++; }
      samples++;
    }
    const edgeDensity = samples ? coherent / samples : 0;
    const clippingPenalty = clipped / count;
    const score = (samples ? gradient / samples : 0) - clippingPenalty * 220 + Math.min(edgeDensity, 0.16) * 18;
    variants.push({ name, jpeg: canvas.toDataURL('image/jpeg', 0.94).split(',')[1] || '', score });
  };

  // 1. Locally adaptive shadow recovery. The local illumination estimate avoids
  // lifting the entire label uniformly and retains the original color ratios.
  render('adaptive-shadow-recovery', (r, g, b, y, i) => {
    const base = localLight[i];
    const gain = 1.0 + Math.max(0, 118 - base) / 118 * 0.82;
    const lifted = base + (y - base) * gain + Math.max(0, 92 - base) * 0.34;
    const mapped = 255 * Math.pow(Math.max(0, Math.min(1, lifted / 255)), 0.88);
    const scale = y > 3 ? mapped / y : 1;
    return [r * scale, g * scale, b * scale];
  });

  // 2. Highlight compression with a gentle shadow toe: useful for foil/glass
  // reflections while avoiding aggressive clipping of small printed strokes.
  render('highlight-shadow-balance', (r, g, b, y) => {
    const lifted = y + (255 - y) * Math.pow(Math.max(0, y / 255), 3) * -0.34 + Math.max(0, 82 - y) * 0.28;
    const mapped = 255 * (lifted / (lifted + 48)) * (303 / 255);
    const scale = y > 3 ? mapped / y : 1;
    return [r * scale, g * scale, b * scale];
  });

  // 3. Luminance-only local detail enhancement. Chroma is preserved as a ratio,
  // which helps retain red ink and colored label cues without inventing color.
  render('local-detail-recovery', (r, g, b, y, i) => {
    const detail = y - localLight[i];
    const enhanced = y + detail * 0.72;
    const scale = y > 3 ? enhanced / y : 1;
    return [r * scale, g * scale, b * scale];
  });

  // 4. Red-ink separation: red-channel-weighted luminance can reveal red print
  // on dark stock, but it remains a separate candidate rather than replacing RGB.
  render('red-ink-separation', (r, g, b, y) => {
    const weighted = 0.48 * r + 0.38 * g + 0.14 * b;
    const mapped = Math.max(0, Math.min(255, (weighted - 104) * 1.42 + 132));
    return [mapped, mapped, mapped];
  });

  // 5. Neutral high-frequency candidate for tiny type and fine linework.
  render('fine-print-grayscale', (r, g, b, y, i) => {
    const local = localLight[i];
    const enhanced = Math.max(0, Math.min(255, (y - local) * 1.35 + local * 1.04));
    return [enhanced, enhanced, enhanced];
  });

  return variants.filter(v => !!v.jpeg).sort((a, b) => b.score - a.score);
}

type PhotoState = { status: 'reading' | 'done' | 'error'; bottles: BottleRead[]; visualBottles: BottleRead[]; visualMenu: MenuGlimpse | null; scanStage: 0 | 1 | 2 | 3 | 4 | 5; menu: MenuGlimpse | null; note: string };
const EMPTY: PhotoState = { status: 'reading', bottles: [], visualBottles: [], visualMenu: null, scanStage: 0, menu: null, note: '' };

/** One frozen photo with its own sweep line, glowing edges and name tags. */
function PhotoScanner({ uri, state, compact, onLoaded }: { uri: string; state: PhotoState; compact: boolean; onLoaded: (jpegBase64: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(0);
  const readingRef = useRef(true);
  const boxesRef = useRef<Array<{ box: BottleRead['box']; labelBox: BottleRead['label_box'] }>>([]);
  useEffect(() => { readingRef.current = state.status === 'reading'; }, [state.status]);
  useEffect(() => {
    // Only confidently detected bottle regions are eligible for edge tracing.
    // Glassware, tables and background details outside those boxes are excluded.
    boxesRef.current = (state.visualBottles.length ? state.visualBottles : state.bottles).filter(b => b.state !== 'unsure').map(b => ({ box: b.box, labelBox: b.label_box || null }));
  }, [state.bottles, state.visualBottles]);

  useEffect(() => {
    let alive = true, raf = 0;
    const img = new Image();
    img.onload = () => {
      if (!alive || !img.naturalWidth) return;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      setRatio(iw / ih);
      const s2 = Math.min(1, SEND_LONG / Math.max(iw, ih)), shot = document.createElement('canvas');
      shot.width = Math.round(iw * s2); shot.height = Math.round(ih * s2);
      shot.getContext('2d')!.drawImage(img, 0, 0, shot.width, shot.height);
      onLoaded(shot.toDataURL('image/jpeg', 0.76).replace(/^data:image\/jpeg;base64,/, ''));
      const s1 = EDGE_LONG / Math.max(iw, ih), EW = Math.max(2, Math.round(iw * s1)), EH = Math.max(2, Math.round(ih * s1));
      const work = document.createElement('canvas'); work.width = EW; work.height = EH;
      const wctx = work.getContext('2d', { willReadFrequently: true })!; wctx.drawImage(img, 0, 0, EW, EH);
      const px = wctx.getImageData(0, 0, EW, EH).data, n = EW * EH, gray = new Uint8ClampedArray(n), alpha = new Uint8ClampedArray(n);
      for (let i = 0, j = 0; i < n; i += 1, j += 4) gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
      for (let y = 1; y < EH - 1; y += 1) for (let x = 1; x < EW - 1; x += 1) {
        const i = y * EW + x;
        const gx = -gray[i - EW - 1] - 2 * gray[i - 1] - gray[i + EW - 1] + gray[i - EW + 1] + 2 * gray[i + 1] + gray[i + EW + 1];
        const gy = -gray[i - EW - 1] - 2 * gray[i - EW] - gray[i - EW + 1] + gray[i + EW - 1] + 2 * gray[i + EW] + gray[i + EW + 1];
        const m = Math.abs(gx) + Math.abs(gy);
        const nx = x / EW, ny = y / EH;
        const threshold = state.scanStage >= 3 ? 42 : state.scanStage === 2 ? 58 : 72;
        alpha[i] = m < threshold ? 0 : Math.min(170, (m - threshold) * 0.9);
      }
      const canvas = canvasRef.current; if (!canvas) return;
      if (canvas.width !== EW) canvas.width = EW; if (canvas.height !== EH) canvas.height = EH;
      const ctx = canvas.getContext('2d')!, out = ctx.createImageData(EW, EH), o = out.data;      // Carry the previously revealed passes forward instead of clearing their traces.
      o.set(ctx.getImageData(0, 0, EW, EH).data);
      const shown = new Uint8Array(EH); let lastRow = -1, shownCount = 0; const t0 = performance.now();
      const tick = (now: number) => {
        if (!alive) return;
        let p = Math.max(0, Math.min(1, (now - t0) / SWEEP_MS));
        if (state.scanStage === 2 || state.scanStage === 4) p = 1 - p;
        if (state.scanStage === 5) { const cycle = ((now - t0) / SWEEP_MS) % 2; p = cycle <= 1 ? cycle : 2 - cycle; }
        p = p * p * (3 - 2 * p);
        const row = Math.round(p * (EH - 1));
        if (lastRow < 0) lastRow = row;
        const a = Math.min(row, lastRow), b = Math.max(row, lastRow); let dirty = false;
        for (let y = a; y <= b; y += 1) {
          // Wait for object recognition; never trace the room while recognition is pending.
          if (!boxesRef.current.length || shown[y]) continue;
          shown[y] = 1; shownCount += 1; dirty = true;
          for (let x = 0; x < EW; x += 1) {
            const i = y * EW + x, k = i * 4, nx = x / EW, ny = y / EH;
            const relevant = boxesRef.current.some(item => { const region = state.scanStage === 1 ? item.box : item.labelBox || item.box; return nx >= region.x0 && nx <= region.x1 && ny >= region.y0 && ny <= region.y1; });
            o[k] = 226; o[k + 1] = 238; o[k + 2] = 255; o[k + 3] = relevant ? alpha[i] : 0;
          }
        }
        if (dirty) ctx.putImageData(out, 0, 0, 0, a, EW, b - a + 1);
        lastRow = row;
        const working = readingRef.current || (state.scanStage >= 1 && state.scanStage <= 5 && shownCount < EH);
        if (lineRef.current) lineRef.current.style.opacity = state.status === 'reading' && (state.scanStage === 0 || state.scanStage === 5) ? '1' : '0';
        if (working) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    img.src = uri;
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, state.scanStage]);

  return (
    <div style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', aspectRatio: ratio ? String(ratio) : undefined, maxWidth: '100%', maxHeight: '100%', width: ratio >= 1 ? '100%' : undefined, height: ratio && ratio < 1 ? '100%' : undefined, overflow: 'hidden' }}>
        <img src={uri} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        <div style={{ ...fill, background: 'rgba(5,10,40,.28)' }} />
        {state.scanStage >= 1 && state.scanStage <= 5 && <canvas ref={canvasRef} aria-hidden style={{ ...fill, filter: 'drop-shadow(0 0 1px rgba(79,139,255,.55)) drop-shadow(0 0 3px rgba(43,86,240,.3))' }} />}
        {state.scanStage === 4 && <div aria-hidden style={{ position: 'absolute', left: '50%', top: '12%', transform: 'translateX(-50%)', padding: '5px 9px', border: '1px solid rgba(169,212,255,.45)', borderRadius: 6, background: 'rgba(5,12,30,.58)', color: 'rgba(225,239,255,.9)', fontSize: 10, letterSpacing: 1.4, whiteSpace: 'nowrap', textShadow: '0 0 4px rgba(79,139,255,.35)' }}>FINE-PRINT EXTRACTION</div>}
        {(state.scanStage === 0 || state.scanStage === 5) && <div ref={lineRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, marginTop: -1, background: '#bcd4ff', boxShadow: '0 0 8px 2px #4f8bff,0 0 22px 6px #2b56f0,0 0 46px 10px #1d3fd8', opacity: state.status === 'reading' ? 1 : 0, animation: state.status === 'reading' ? 'hdPreScan 4.6s ease-in-out infinite' : 'none', transition: 'opacity .35s' }} />}
        {state.bottles.map((b, i) => {
          const cx = ((b.box.x0 + b.box.x1) / 2) * 100, top = Math.max(compact ? 10 : 6, b.box.y0 * 100 - 2), isUnsure = b.state === 'unsure';
          return <div key={`${keyOf(b) || 'u'}-${i}`} style={{ position: 'absolute', left: `${cx}%`, top: `${top}%`, transform: 'translate(-50%,-100%)', textAlign: 'center', pointerEvents: 'none', animation: 'hdRise .35s ease-out both', animationDelay: `${i * 0.12}s`, maxWidth: '46%' }}>
            <div style={isUnsure ? { ...word, color: '#ffd27a', textShadow: AMBER_GLOW, fontSize: compact ? 10 : 13, whiteSpace: 'nowrap' } : { ...word, fontSize: compact ? 10 : 14, whiteSpace: 'nowrap' }}>{isUnsure ? 'Unsure' : nameOf(b)}</div>
          </div>;
        })}
      </div>
    </div>
  );
}

export default function LiveScanner({ photos, onClose, source = 'camera', mode = 'auto' }: { photos: string[]; onClose: () => void; source?: 'camera' | 'gallery'; mode?: 'bottle' | 'menu' | 'auto' }) {
  const uris = useMemo(() => photos.slice(0, MAX_PHOTOS), [photos]);
  const many = uris.length > 1;
  const { addPages } = useScan();
  const session = useMemo(() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'), []);
  const [states, setStates] = useState<PhotoState[]>(() => uris.map(() => EMPTY));
  const [open, setOpen] = useState<number | null>(many ? null : 0);
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [review, setReview] = useState(false);
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);
  const [researchComplete, setResearchComplete] = useState(false);
  const [note, setNote] = useState('');
  const started = useRef<Record<number, true>>({});

  const patch = (i: number, next: Partial<PhotoState>) => setStates(prev => prev.map((s, k) => (k === i ? { ...s, ...next } : s)));
  function read(i: number, jpeg: string) {
    if (started.current[i]) return; started.current[i] = true;
    const visualStarted = performance.now();
    setTimeout(async () => {
      try {
        const result = await readLiveFrame(jpeg);
        // Three distinct visual passes: bottle silhouette, paper/foil/sticker label,
        // then fine image details inside the bottle region. Keep text data hidden until all finish.
        patch(i, { visualBottles: result.bottles, visualMenu: result.menu.visible ? result.menu : null, scanStage: 1 });
        await new Promise(resolve => setTimeout(resolve, SWEEP_MS));
        patch(i, { scanStage: 2 });
        await new Promise(resolve => setTimeout(resolve, SWEEP_MS));
        patch(i, { scanStage: 3 });
        await new Promise(resolve => setTimeout(resolve, SWEEP_MS));
        // Pass 4 magnifies each label. Pass 5 keeps sweeping while local enhancement
        // variants are generated and the strongest candidates are sent for fine-print OCR.
        patch(i, { scanStage: 4 });
        // Hard budget: at most two bottles and one enhanced OCR request per bottle.
        // The initial full-frame read is the baseline; do not resend every recipe to the model.
        const fineReads = await Promise.all(result.bottles.slice(0, 2).map(async bottle => {
          try {
            const crop = await makeFinePrintCrop(uris[i], bottle.label_box || bottle.box);
            if (!crop) return [];
            patch(i, { scanStage: 5 });
            const variants = await makeFinePrintVariants(crop);
            const selected = variants.filter(v => v.name !== 'original').slice(0, 1);
            const reads = await Promise.all(selected.map(async variant => {
              try {
                const response = await withFinePrintSlot(() => readLiveFrame(variant.jpeg, 'fine_print'));
                return { name: variant.name, bottles: response.bottles };
              } catch { return null; }
            }));
            return reads.filter((v): v is { name: string; bottles: BottleRead[] } => !!v).flatMap(v => v.bottles.map(read => ({ name: v.name, read })));
          } catch { return []; }
        }));
        const finalBottles = result.bottles.map((bottle, index) => {
          const candidates = fineReads[index] || [];
          const fine = candidates.map(c => c.read).filter(Boolean).sort((a, b) => {
            const confidence = (x: BottleRead) => Object.values(x.fieldConfidence || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
            return confidence(b) - confidence(a);
          })[0];
          if (!fine) return bottle;
          const details = { ...bottle.details };
          const fieldConfidence = { ...bottle.fieldConfidence };
          for (const candidate of candidates.map(c => c.read)) {
            for (const [key, value] of Object.entries(candidate.details || {})) {
              const score = Number(candidate.fieldConfidence?.[key] || 0);
              if (!value || score < 0.78) continue;
              if (!details[key] || score > Number(fieldConfidence[key] || 0)) {
                details[key] = value;
                fieldConfidence[key] = score;
              }
            }
          }
          const supported = (field: string, value: string) => value && Number(fine.fieldConfidence?.[field] || 0) >= 0.78 ? value : '';
          return { ...bottle, details,
            proof: bottle.proof || supported('proof', fine.proof),
            size: bottle.size || supported('size', fine.size),
            origin: bottle.origin || supported('origin', fine.origin),
            fieldConfidence };
        });
        patch(i, { status: 'done', bottles: finalBottles, visualBottles: [], visualMenu: null, scanStage: 0, menu: result.menu.visible ? result.menu : null });
      } catch (error) {
        const remaining = Math.max(0, 4600 - (performance.now() - visualStarted));
        if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
        patch(i, { status: 'error', note: bottleErrorMessage(error) });
      }
    }, i * 500);
  }

  const all = states.flatMap(s => s.bottles);
  const tally = useMemo(() => { const map: Record<string, BottleRead> = {}; for (const b of all) { const k = keyOf(b); if (b.state !== 'unsure' && k && !removed[k]) map[k] = b; } return Object.values(map); }, [states, removed]);
  const unsure = all.filter(b => b.state === 'unsure').length;
  const reading = states.filter(s => s.status === 'reading').length;
  const menuPages = uris.filter((_, i) => states[i]?.menu);
  const menuItems = states.reduce((sum, s) => sum + (s.menu?.items.length || 0), 0);
  const cur = open === null ? null : states[open];
  const focus = cur ? cur.bottles.filter(b => b.state !== 'unsure').sort((a, b) => Math.abs((a.box.x0 + a.box.x1) / 2 - 0.5) - Math.abs((b.box.x0 + b.box.x1) / 2 - 0.5))[0] || null : null;
  const showMenu = !!cur && !focus && !!cur.menu;
  const facts: Array<[string, string]> = focus ? factsOf(focus) : showMenu ? cur!.menu!.items.slice(0, 12).map(it => [it.price || it.type, it.name] as [string, string]) : [];
  const sideKey = focus ? keyOf(focus) : showMenu ? `menu-${open}` : '';
  function keepMenu() { if (!menuPages.length) return; addPages(menuPages, source); router.push('/preview'); }
  async function save() {
    if (!tally.length || saving) return;
    setSaving(true);
    try {
      const result = await saveBottleSightings(session, venue.trim(), tally);
      setStates(prev => prev.map(photo => ({ ...photo, bottles: photo.bottles.map(b => {
        const researched = result.enriched.find(x => x.brand.trim().toLowerCase() === (b.match?.brand || b.brand).trim().toLowerCase() && x.product.trim().toLowerCase() === b.product.trim().toLowerCase());
        if (!researched) return b;
        return { ...b, details: { ...b.details, ...(researched.details || {}) }, fieldConfidence: { ...b.fieldConfidence, ...(researched.fieldConfidence || {}) }, researchSources: researched.researchSources || b.researchSources };
      }) })));
      setResearchComplete(true);
      setReview(false); setRemoved(prev => ({ ...prev, ...Object.fromEntries(tally.map(b => [keyOf(b), true as const])) }));
      const researchedFields = result.enriched.reduce((sum, b) => sum + Object.keys(b.details || {}).length, 0);
      setNote(`Saved ${result.saved} bottle${result.saved === 1 ? '' : 's'} · ${researchedFields} researched fields added`);
    } catch (error) { setNote(bottleErrorMessage(error)); }
    finally { setSaving(false); }
  }

  const cols = uris.length <= 2 ? 1 : 2, rows = Math.ceil(uris.length / cols);
  const status = reading ? (many ? `Harmony is reading ${reading} of ${uris.length}` : 'Harmony is reading') : cur?.status === 'error' ? cur.note : '';
  const glassPanel: CSSProperties = { background: 'rgba(7,14,32,.48)', backdropFilter: 'blur(18px) saturate(165%)', WebkitBackdropFilter: 'blur(18px) saturate(165%)', border: '1px solid rgba(125,170,255,.48)', boxShadow: '0 8px 28px rgba(0,0,0,.24), inset 0 1px 0 rgba(225,240,255,.12)', borderRadius: 14, boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', pointerEvents: 'auto' };
  const singleLine: CSSProperties = { whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', minWidth: 0 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050a1c', overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <style>{`
        @keyframes hdFlyL{from{opacity:0;transform:translate(38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdFlyR{from{opacity:0;transform:translate(-38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes hdPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes hdPreScan{0%{top:0%;opacity:.35}8%{opacity:1}50%{top:100%;opacity:1}92%{opacity:1}100%{top:0%;opacity:.35}}
        .hd-info-panel,.hd-research-panel{scrollbar-width:thin;scrollbar-color:rgba(120,170,255,.45) transparent}
        .hd-single-line{white-space:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
        .hd-single-line::-webkit-scrollbar{display:none}
        .hd-result-row{display:grid;grid-template-columns:minmax(0,42%) minmax(0,1fr);column-gap:8px;align-items:center;min-width:0}
        @media (max-width: 760px){
          .hd-info-panel{left:6px!important;right:auto!important;width:calc(50vw - 9px)!important}
          .hd-research-panel{right:6px!important;left:auto!important;width:calc(50vw - 9px)!important}
          .hd-info-panel,.hd-research-panel{top:22%!important;bottom:104px!important;padding:9px!important;border-radius:13px!important}
        }
        @media (max-width: 380px){
          .hd-result-row{grid-template-columns:minmax(0,40%) minmax(0,1fr);column-gap:5px}
          .hd-info-panel,.hd-research-panel{padding:7px!important}
        }
        @media (prefers-reduced-motion: reduce){.hd-fly{animation:none!important}}
      `}</style>

      <div style={{ position: 'absolute', left: 0, right: 0, top: many && open === null ? 64 : 0, bottom: 74, display: 'grid', gridTemplateColumns: open === null ? `repeat(${cols}, minmax(0,1fr))` : 'minmax(0,1fr)', gridTemplateRows: open === null ? `repeat(${rows}, minmax(0,1fr))` : 'minmax(0,1fr)', gap: open === null ? 6 : 0 }}>
        {uris.map((uri, i) => (
          <div key={uri + i} role={many && open === null ? 'button' : undefined} aria-label={many && open === null ? `Open photo ${i + 1}` : undefined}
            onClick={() => { if (many && open === null) setOpen(i); }}
            style={{ position: 'relative', minWidth: 0, minHeight: 0, display: open === null || open === i ? 'block' : 'none', cursor: many && open === null ? 'pointer' : undefined }}>
            <PhotoScanner uri={uri} state={states[i]} compact={open === null} onLoaded={jpeg => read(i, jpeg)} />
            {open === null && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', pointerEvents: 'none' }}><span style={{ ...word, fontSize: 12, whiteSpace: 'nowrap', animation: states[i].status === 'reading' ? 'hdPulse 1s ease-in-out infinite' : undefined }}>{states[i].status === 'reading' ? 'Reading…' : states[i].status === 'error' ? "Couldn't read" : states[i].menu ? `Menu · ${states[i].menu!.items.length} items` : `${states[i].bottles.filter(b => b.state !== 'unsure').length} read`}</span></div>}
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', left: 16, top: 'max(14px, env(safe-area-inset-top))', ...word, fontSize: 16, cursor: 'pointer', padding: '8px 4px' }} role="button" aria-label={many && open !== null ? 'Back to all photos' : 'Scan again'} onClick={() => (many && open !== null ? setOpen(null) : onClose())}>{many && open !== null ? '‹ All photos' : '‹ Scan again'}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 'max(22px, calc(env(safe-area-inset-top) + 8px))', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ ...dim, fontSize: 13, padding: '0 110px', whiteSpace: 'nowrap', animation: reading ? 'hdPulse 1s ease-in-out infinite' : undefined }}>{status}</div>
        {showMenu && <div key={sideKey} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}><div style={{ ...word, fontSize: 22, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur!.menu!.title || 'Menu'}</div><div style={{ ...dim, fontSize: 11, marginTop: 6, whiteSpace: 'nowrap' }}>{cur!.menu!.items.length} items read</div></div>}
        {focus && <div key={sideKey} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}><div style={{ ...word, fontSize: 22, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(focus)}</div><div style={focus.state === 'matched' ? { ...word, fontSize: 11, color: '#7dffb5', textShadow: OK_GLOW, marginTop: 6, whiteSpace: 'nowrap' } : { ...dim, fontSize: 11, marginTop: 6, whiteSpace: 'nowrap' }}>{focus.state === 'matched' ? '✓ Matched' : 'Read from the label'}</div></div>}
      </div>

      {facts.length > 0 && <div key={sideKey} className="hd-info-panel" style={{ ...glassPanel, position: 'absolute', left: 6, top: '22%', bottom: 104, width: 'calc(50vw - 9px)', padding: '10px 9px' }}>
        {facts.map(([label, value], i) => <div key={`${label}-${i}`} className="hd-result-row" style={{ padding: '8px 0', borderBottom: '1px solid rgba(180,205,245,.2)' }}>
          <div className="hd-single-line" style={{ ...dim, fontSize: 'clamp(8px, 2.15vw, 10px)', letterSpacing: '.1px', lineHeight: 1.15 }}>{label}</div>
          <div className="hd-single-line" style={{ ...word, fontSize: 'clamp(9px, 2.5vw, 12px)', lineHeight: 1.15, textAlign: 'left' }}>{value}</div>
        </div>)}
      </div>}

      {focus && <div key={sideKey + '-research'} className="hd-research-panel" style={{ ...glassPanel, position: 'absolute', right: 6, top: '22%', bottom: 104, width: 'calc(50vw - 9px)', padding: '10px 9px' }}>
        <div style={{ ...word, fontSize: 'clamp(11px, 2.9vw, 14px)', marginBottom: 5, whiteSpace: 'nowrap' }}>Research targets</div>
        <div className="hd-single-line" style={{ ...dim, fontSize: 'clamp(8px, 2vw, 10px)', lineHeight: 1.3, marginBottom: 10 }}>{saving ? 'Searching trusted sources and matching the exact expression…' : researchComplete ? 'Research results for this saved bottle' : 'Built from the label read. Research runs when you save.'}</div>
        {RESEARCH_GROUPS.map(group => {
          const found = group.fields.filter(([, key]) => !!researchValue(focus, key));
          return <div key={group.title} style={{ marginBottom: 10 }}>
            <div className="hd-single-line" style={{ ...dim, fontSize: 'clamp(8px, 2vw, 10px)', letterSpacing: .5, marginBottom: 4 }}>{group.title.toUpperCase()} · {found.length}/{group.fields.length}</div>
            {group.fields.map(([label, key]) => {
              const value = researchValue(focus, key);
              const state = value ? 'FOUND' : researchComplete ? 'NOT FOUND' : 'QUEUED';
              return <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 5, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(180,205,245,.16)', minWidth: 0 }}>
                <div className="hd-single-line" style={{ ...dim, fontSize: 'clamp(8px, 2vw, 10px)', lineHeight: 1.15, flex: 1 }}>{label}</div>
                <div style={{ ...word, color: value ? '#7dffb5' : researchComplete ? '#ffd27a' : '#a9bad7', fontSize: 'clamp(7px, 1.8vw, 9px)', whiteSpace: 'nowrap', flexShrink: 0 }}>{state}</div>
              </div>;
            })}
          </div>;
        })}
        {(focus.researchSources || []).length > 0 && <div style={{ borderTop: '1px solid rgba(79,139,255,.35)', paddingTop: 8, marginTop: 5 }}>
          <div style={{ ...word, fontSize: 10, marginBottom: 5, whiteSpace: 'nowrap' }}>Sources · {focus.researchSources.length}</div>
          {focus.researchSources.slice(0, 5).map((source, i) => <div key={source.url || i} className="hd-single-line" style={{ ...dim, fontSize: 8, lineHeight: 1.3, marginBottom: 4 }}>{source.title || source.url}</div>)}
        </div>}
      </div>}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 22px max(18px, env(safe-area-inset-bottom))' }}>
        {note ? <div style={{ ...dim, fontSize: 12, textAlign: 'center', marginBottom: 7, whiteSpace: 'nowrap' }}>{note}</div> : null}
        <div style={{ height: 1, background: '#4f8bff', boxShadow: '0 0 8px #2b56f0', opacity: 0.7, marginBottom: 10 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ ...word, fontSize: 14, whiteSpace: 'nowrap' }}>{[tally.length || !menuItems ? `${tally.length} read` : '', unsure ? `${unsure} unsure` : '', menuItems ? `${menuItems} menu items` : ''].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {menuPages.length > 0 && <div role="button" aria-label="Keep the menu" style={{ ...word, fontSize: 14, cursor: 'pointer', padding: '8px 0', whiteSpace: 'nowrap' }} onClick={keepMenu}>Keep menu</div>}
            {tally.length > 0 && <div role="button" aria-label="Review bottles" style={{ ...word, fontSize: 14, cursor: 'pointer', padding: '8px 0', whiteSpace: 'nowrap' }} onClick={() => setReview(true)}>Review</div>}
          </div>
        </div>
      </div>

      {review && <div style={{ ...fill, background: 'rgba(4,10,40,.9)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ padding: 'max(22px, env(safe-area-inset-top)) 22px 40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><div style={{ ...word, fontSize: 22 }}>Bottles read</div><div role="button" style={{ ...word, fontSize: 14, cursor: 'pointer', padding: 8 }} onClick={() => setReview(false)}>Back</div></div>
          <div style={{ marginTop: 14 }}>{tally.map(b => <div key={keyOf(b)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(79,139,255,.45)' }}>
            <div style={{ flex: 1, minWidth: 0 }}><div className="hd-single-line" style={{ ...word, fontSize: 15 }}>{nameOf(b)}</div><div className="hd-single-line" style={{ ...dim, fontSize: 11, marginTop: 3 }}>{[CATEGORY[b.category], text(b.details?.vintage), text(b.details?.classification), b.proof].filter(Boolean).join(' · ') || 'Read from the label'}</div></div>
            <div role="button" aria-label={`Remove ${nameOf(b)}`} style={{ ...word, fontSize: 20, cursor: 'pointer', padding: '4px 10px' }} onClick={() => setRemoved(prev => ({ ...prev, [keyOf(b)]: true }))}>×</div>
          </div>)}</div>
          <input value={venue} onChange={e => setVenue(e.target.value)} maxLength={120} placeholder="Where are you? The Dove Bar" aria-label="Venue name" style={{ ...word, fontSize: 15, width: '100%', marginTop: 22, padding: '10px 0', background: 'transparent', border: 'none', borderBottom: '1px solid #4f8bff', outline: 'none', borderRadius: 0, boxSizing: 'border-box' }} />
          <div role="button" style={{ ...word, fontSize: 18, marginTop: 24, cursor: 'pointer', opacity: tally.length && !saving ? 1 : 0.45, padding: '8px 0' }} onClick={save}>{saving ? 'Saving…' : `Save ${tally.length} bottle${tally.length === 1 ? '' : 's'}`}</div>
        </div>
      </div>}
    </div>
  );
}