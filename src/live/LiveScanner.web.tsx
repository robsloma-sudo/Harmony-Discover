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
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1] || '';
}

type PhotoState = { status: 'reading' | 'done' | 'error'; bottles: BottleRead[]; visualBottles: BottleRead[]; visualMenu: MenuGlimpse | null; scanStage: 0 | 1 | 2 | 3 | 4; menu: MenuGlimpse | null; note: string };
const EMPTY: PhotoState = { status: 'reading', bottles: [], visualBottles: [], visualMenu: null, scanStage: 0, menu: null, note: '' };

/** One frozen photo with its own sweep line, glowing edges and name tags. */
function PhotoScanner({ uri, state, compact, onLoaded }: { uri: string; state: PhotoState; compact: boolean; onLoaded: (jpegBase64: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(0);
  const readingRef = useRef(true);
  const boxesRef = useRef<BottleRead['box'][]>([]);
  useEffect(() => { readingRef.current = state.status === 'reading'; }, [state.status]);
  useEffect(() => {
    // Only confidently detected bottle regions are eligible for edge tracing.
    // Glassware, tables and background details outside those boxes are excluded.
    boxesRef.current = (state.visualBottles.length ? state.visualBottles : state.bottles).filter(b => b.state !== 'unsure').map(b => b.box);
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
        alpha[i] = m < 65 ? 0 : Math.min(150, (m - 65) * 0.85);
      }
      const canvas = canvasRef.current; if (!canvas) return;
      canvas.width = EW; canvas.height = EH;
      const ctx = canvas.getContext('2d')!, out = ctx.createImageData(EW, EH), o = out.data;
      const shown = new Uint8Array(EH); let lastRow = -1, shownCount = 0; const t0 = performance.now();
      const tick = (now: number) => {
        if (!alive) return;
        let p = ((now - t0) / SWEEP_MS) % 2; p = p < 1 ? p : 2 - p; p = p * p * (3 - 2 * p);
        const row = Math.round(p * (EH - 1));
        if (lastRow < 0) lastRow = row;
        const a = Math.min(row, lastRow), b = Math.max(row, lastRow); let dirty = false;
        for (let y = a; y <= b; y += 1) {
          // Wait for object recognition; never trace the room while recognition is pending.
          if (!boxesRef.current.length || shown[y]) continue;
          shown[y] = 1; shownCount += 1; dirty = true;
          for (let x = 0; x < EW; x += 1) {
            const i = y * EW + x, k = i * 4, nx = x / EW, ny = y / EH;
            const relevant = boxesRef.current.some(box => nx >= box.x0 && nx <= box.x1 && ny >= box.y0 && ny <= box.y1);
            o[k] = 226; o[k + 1] = 238; o[k + 2] = 255; o[k + 3] = relevant ? alpha[i] : 0;
          }
        }
        if (dirty) ctx.putImageData(out, 0, 0, 0, a, EW, b - a + 1);
        lastRow = row;
        const working = readingRef.current || (state.scanStage === 3 && shownCount < EH);
        if (lineRef.current) lineRef.current.style.opacity = state.status === 'reading' && state.scanStage === 0 ? '1' : '0';
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
        {state.scanStage === 3 && <canvas ref={canvasRef} aria-hidden style={{ ...fill, filter: 'drop-shadow(0 0 1px rgba(79,139,255,.55)) drop-shadow(0 0 3px rgba(43,86,240,.3))' }} />}
        {state.scanStage === 4 && <div aria-hidden style={{ position: 'absolute', left: '50%', top: '12%', transform: 'translateX(-50%)', padding: '5px 9px', border: '1px solid rgba(169,212,255,.45)', borderRadius: 6, background: 'rgba(5,12,30,.58)', color: 'rgba(225,239,255,.9)', fontSize: 10, letterSpacing: 1.4, whiteSpace: 'nowrap', textShadow: '0 0 4px rgba(79,139,255,.35)' }}>FINE-PRINT EXTRACTION</div>}
        {state.scanStage === 0 && <div ref={lineRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, marginTop: -1, background: '#bcd4ff', boxShadow: '0 0 8px 2px #4f8bff,0 0 22px 6px #2b56f0,0 0 46px 10px #1d3fd8', opacity: state.status === 'reading' ? 1 : 0, animation: state.status === 'reading' ? 'hdPreScan 4.6s ease-in-out infinite' : 'none', transition: 'opacity .35s' }} />}
        {state.scanStage === 2 && state.visualMenu?.box && <div aria-hidden style={{ position: 'absolute', left: `${state.visualMenu.box.x0 * 100}%`, top: `${state.visualMenu.box.y0 * 100}%`, width: `${(state.visualMenu.box.x1 - state.visualMenu.box.x0) * 100}%`, height: `${(state.visualMenu.box.y1 - state.visualMenu.box.y0) * 100}%`, border: '1px solid rgba(125,255,181,.78)', borderRadius: 5, boxSizing: 'border-box', boxShadow: '0 0 3px rgba(125,255,181,.4), inset 0 0 3px rgba(125,255,181,.12)' }} />}
        {(state.scanStage === 1 || state.scanStage === 2) && state.visualBottles.map((b, i) => {
          const box = state.scanStage === 1 ? b.box : b.label_box;
          if (!box) return null;
          return <div key={`stage-${state.scanStage}-${i}`} aria-hidden style={{ position: 'absolute', left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%`, border: state.scanStage === 1 ? '1px solid rgba(169,212,255,.82)' : '1px solid rgba(125,255,181,.78)', borderRadius: state.scanStage === 1 ? 18 : 4, boxSizing: 'border-box', boxShadow: state.scanStage === 1 ? '0 0 3px rgba(79,139,255,.45), inset 0 0 3px rgba(79,139,255,.15)' : '0 0 3px rgba(125,255,181,.4), inset 0 0 3px rgba(125,255,181,.12)', transition: 'all .25s ease-out' }} />;
        })}
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
        // Fourth pass: magnify each detected label from the original photo, then ask
        // the vision model specifically for fine print. Keep the original read if this fails.
        patch(i, { scanStage: 4 });
        const fineReads = await Promise.all(result.bottles.slice(0, 4).map(async bottle => {
          try {
            const crop = await makeFinePrintCrop(uris[i], bottle.label_box || null);
            return crop ? await readLiveFrame(crop, 'fine_print') : null;
          } catch { return null; }
        }));
        const finalBottles = result.bottles.map((bottle, index) => {
          const fine = index < 4 ? fineReads[index]?.bottles?.[0] : null;
          if (!fine) return bottle;
          const details = { ...bottle.details };
          for (const [key, value] of Object.entries(fine.details || {})) if (!details[key] && value) details[key] = value;
          return { ...bottle, details, proof: bottle.proof || fine.proof, size: bottle.size || fine.size, origin: bottle.origin || fine.origin,
            fieldConfidence: { ...bottle.fieldConfidence, ...Object.fromEntries(Object.entries(fine.fieldConfidence || {}).filter(([key]) => !bottle.details?.[key])) },
            words: Array.from(new Set([...(bottle.words || []), ...(fine.words || [])])).slice(0, 20) };
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