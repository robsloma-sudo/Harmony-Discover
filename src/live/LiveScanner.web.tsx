import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { router } from 'expo-router';
import { readLiveFrame, saveBottleSightings, bottleErrorMessage, type BottleRead, type MenuGlimpse } from '../services/discoverLiveApi';
import { useScan } from '../state/ScanContext';

// One scanner for everything: bottles (beer, wine, spirits) and menus. Browser tier.
// It is not a page: the home screen swaps it in once a photo is taken (or up to six are chosen from the library).
// Each photo freezes on the screen and gets its own scanner:
//   1. On the phone: every edge in the photo (bottle curve, cork, label, lettering, menu text) is found once.
//      A neon line sweeps up and down the photo and reveals those edges as glowing lines as it passes.
//   2. In the background: the photo goes to discover-live-read once. What is printed on each label, and any
//      menu, comes back and is thrown out to the sides of the screen.
// Look: Harmony Journeys. Glowing words, no boxes.

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
  const d = b.details || {};
  const rows: Array<[string, string]> = [
    ['Brand', b.match?.brand || b.brand], ['Expression', b.product], ['Type', CATEGORY[b.category] || ''],
    ['Producer', text(d.producer)], ['Vintage', text(d.vintage)], ['Appellation', text(d.appellation)],
    ['Region', text(d.region) || b.origin || text(d.country)], ['Grapes', text(d.grapes)], ['Class', text(d.classification)],
    ['Age', text(d.age_statement)], ['Finish', text(d.cask_finish)], ['Flavour', text(d.flavor)],
    ['Strength', b.proof], ['Size', b.size], ['Batch', text(d.batch)], ['Certified', text(d.certifications)],
  ];
  const seen = new Set<string>();
  return rows.filter(([, v]) => { const k = v.toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

type PhotoState = { status: 'reading' | 'done' | 'error'; bottles: BottleRead[]; menu: MenuGlimpse | null; note: string };
const EMPTY: PhotoState = { status: 'reading', bottles: [], menu: null, note: '' };

/** One frozen photo with its own sweep line, glowing edges and name tags. */
function PhotoScanner({ uri, state, compact, onLoaded }: { uri: string; state: PhotoState; compact: boolean; onLoaded: (jpegBase64: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState(0);
  const readingRef = useRef(true);
  useEffect(() => { readingRef.current = state.status === 'reading'; }, [state.status]);

  useEffect(() => {
    let alive = true, raf = 0;
    const img = new Image();
    img.onload = () => {
      if (!alive || !img.naturalWidth) return;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      setRatio(iw / ih);

      // the copy Harmony reads
      const s2 = Math.min(1, SEND_LONG / Math.max(iw, ih)), shot = document.createElement('canvas');
      shot.width = Math.round(iw * s2); shot.height = Math.round(ih * s2);
      shot.getContext('2d')!.drawImage(img, 0, 0, shot.width, shot.height);
      onLoaded(shot.toDataURL('image/jpeg', 0.76).replace(/^data:image\/jpeg;base64,/, ''));

      // every edge in the photo, found once
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
        alpha[i] = m < 90 ? 0 : Math.min(255, (m - 90) * 2.2);
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
          if (shown[y]) continue; shown[y] = 1; shownCount += 1; dirty = true;
          for (let x = 0; x < EW; x += 1) { const i = y * EW + x, k = i * 4; o[k] = 226; o[k + 1] = 238; o[k + 2] = 255; o[k + 3] = alpha[i]; }
        }
        if (dirty) ctx.putImageData(out, 0, 0, 0, a, EW, b - a + 1);
        lastRow = row;
        // the line keeps sweeping while Harmony is still reading, or until the whole photo is traced
        const working = readingRef.current || shownCount < EH;
        if (lineRef.current) { lineRef.current.style.top = `${p * 100}%`; lineRef.current.style.opacity = working ? '1' : '0'; }
        if (working) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    img.src = uri;
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  return (
    <div style={{ ...fill, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', aspectRatio: ratio ? String(ratio) : undefined, maxWidth: '100%', maxHeight: '100%', width: ratio >= 1 ? '100%' : undefined, height: ratio && ratio < 1 ? '100%' : undefined, overflow: 'hidden' }}>
        <img src={uri} alt="" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        <div style={{ ...fill, background: 'rgba(5,10,40,.28)' }} />
        <canvas ref={canvasRef} aria-hidden style={{ ...fill, filter: 'drop-shadow(0 0 3px #4f8bff) drop-shadow(0 0 9px #2b56f0)' }} />
        <div ref={lineRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, marginTop: -1, background: '#bcd4ff', boxShadow: '0 0 8px 2px #4f8bff,0 0 22px 6px #2b56f0,0 0 46px 10px #1d3fd8', transition: 'opacity .5s' }} />
        {state.bottles.map((b, i) => {
          const cx = ((b.box.x0 + b.box.x1) / 2) * 100, top = Math.max(compact ? 10 : 6, b.box.y0 * 100 - 2), isUnsure = b.state === 'unsure';
          return (
            <div key={`${keyOf(b) || 'u'}-${i}`} style={{ position: 'absolute', left: `${cx}%`, top: `${top}%`, transform: 'translate(-50%,-100%)', textAlign: 'center', pointerEvents: 'none', animation: 'hdRise .35s ease-out both', animationDelay: `${i * 0.12}s`, maxWidth: '46%' }}>
              <div style={isUnsure ? { ...word, color: '#ffd27a', textShadow: AMBER_GLOW, fontSize: compact ? 10 : 13 } : { ...word, fontSize: compact ? 10 : 14 }}>{isUnsure ? 'Unsure' : nameOf(b)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function LiveScanner({ photos, onClose, source = 'camera' }: { photos: string[]; onClose: () => void; source?: 'camera' | 'gallery' }) {
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
  const [note, setNote] = useState('');
  const started = useRef<Record<number, true>>({});

  const patch = (i: number, next: Partial<PhotoState>) => setStates(prev => prev.map((s, k) => (k === i ? { ...s, ...next } : s)));
  function read(i: number, jpeg: string) {
    if (started.current[i]) return; started.current[i] = true;
    // photos are read one after another, a moment apart, so six at once stay inside the per-minute limit
    setTimeout(() => {
      readLiveFrame(jpeg)
        .then(r => patch(i, { status: 'done', bottles: r.bottles, menu: r.menu.visible ? r.menu : null }))
        .catch(error => patch(i, { status: 'error', note: bottleErrorMessage(error) }));
    }, i * 500);
  }

  const all = states.flatMap(s => s.bottles);
  const tally = useMemo(() => {
    const map: Record<string, BottleRead> = {};
    for (const b of all) { const k = keyOf(b); if (b.state !== 'unsure' && k && !removed[k]) map[k] = b; }
    return Object.values(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, removed]);
  const unsure = all.filter(b => b.state === 'unsure').length;
  const reading = states.filter(s => s.status === 'reading').length;
  const menuPages = uris.filter((_, i) => states[i]?.menu);
  const menuItems = states.reduce((sum, s) => sum + (s.menu?.items.length || 0), 0);

  const cur = open === null ? null : states[open];
  const focus = cur ? cur.bottles.filter(b => b.state !== 'unsure').sort((a, b) => Math.abs((a.box.x0 + a.box.x1) / 2 - 0.5) - Math.abs((b.box.x0 + b.box.x1) / 2 - 0.5))[0] || null : null;
  const showMenu = !!cur && !focus && !!cur.menu;
  const facts: Array<[string, string]> = focus ? factsOf(focus) : showMenu ? cur!.menu!.items.slice(0, 12).map(it => [it.price || it.type, it.name] as [string, string]) : [];
  const sideKey = focus ? keyOf(focus) : showMenu ? `menu-${open}` : '';
  const left = facts.filter((_, i) => i % 2 === 0), right = facts.filter((_, i) => i % 2 === 1);

  /** Hands the menu photos to the existing menu flow: review, corrections and consent all happen there. */
  function keepMenu() { if (!menuPages.length) return; addPages(menuPages, source); router.push('/preview'); }

  async function save() {
    if (!tally.length || saving) return;
    setSaving(true);
    try {
      const result = await saveBottleSightings(session, venue.trim(), tally);
      setReview(false); setRemoved(prev => ({ ...prev, ...Object.fromEntries(tally.map(b => [keyOf(b), true as const])) }));
      setNote(`Saved ${result.saved} bottle${result.saved === 1 ? '' : 's'}`);
    } catch (error) { setNote(bottleErrorMessage(error)); }
    finally { setSaving(false); }
  }

  const cols = uris.length <= 2 ? 1 : 2, rows = Math.ceil(uris.length / cols);
  const status = reading ? (many ? `Harmony is reading ${reading} of ${uris.length}` : 'Harmony is reading') : cur?.status === 'error' ? cur.note : '';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050a1c', overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <style>{`
        @keyframes hdFlyL{from{opacity:0;transform:translate(38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdFlyR{from{opacity:0;transform:translate(-38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes hdPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @media (prefers-reduced-motion: reduce){.hd-fly{animation:none!important}}
      `}</style>

      {/* every photo stays mounted so its scanner keeps running; the grid just rearranges them */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: many && open === null ? 64 : 0, bottom: 74, display: 'grid', gridTemplateColumns: open === null ? `repeat(${cols}, minmax(0,1fr))` : 'minmax(0,1fr)', gridTemplateRows: open === null ? `repeat(${rows}, minmax(0,1fr))` : 'minmax(0,1fr)', gap: open === null ? 6 : 0 }}>
        {uris.map((uri, i) => (
          <div key={uri + i} role={many && open === null ? 'button' : undefined} aria-label={many && open === null ? `Open photo ${i + 1}` : undefined}
            onClick={() => { if (many && open === null) setOpen(i); }}
            style={{ position: 'relative', minWidth: 0, minHeight: 0, display: open === null || open === i ? 'block' : 'none', cursor: many && open === null ? 'pointer' : undefined }}>
            <PhotoScanner uri={uri} state={states[i]} compact={open === null} onLoaded={jpeg => read(i, jpeg)} />
            {open === null && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 4, textAlign: 'center', pointerEvents: 'none' }}>
                <span style={{ ...word, fontSize: 12, animation: states[i].status === 'reading' ? 'hdPulse 1s ease-in-out infinite' : undefined }}>
                  {states[i].status === 'reading' ? 'Reading…' : states[i].status === 'error' ? "Couldn't read" : states[i].menu ? `Menu · ${states[i].menu!.items.length} items` : `${states[i].bottles.filter(b => b.state !== 'unsure').length} read`}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', left: 16, top: 'max(14px, env(safe-area-inset-top))', ...word, fontSize: 16, cursor: 'pointer', padding: '8px 4px' }} role="button"
        aria-label={many && open !== null ? 'Back to all photos' : 'Scan again'} onClick={() => (many && open !== null ? setOpen(null) : onClose())}>{many && open !== null ? '‹ All photos' : '‹ Scan again'}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 'max(22px, calc(env(safe-area-inset-top) + 8px))', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ ...dim, fontSize: 13, padding: '0 110px', animation: reading ? 'hdPulse 1s ease-in-out infinite' : undefined }}>{status}</div>
        {showMenu && (
          <div key={sideKey} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}>
            <div style={{ ...word, fontSize: 26, lineHeight: 1.15 }}>{cur!.menu!.title || 'Menu'}</div>
            <div style={{ ...dim, fontSize: 12, marginTop: 6 }}>{cur!.menu!.items.length} items read</div>
          </div>
        )}
        {focus && (
          <div key={sideKey} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}>
            <div style={{ ...word, fontSize: 26, lineHeight: 1.15 }}>{nameOf(focus)}</div>
            <div style={focus.state === 'matched' ? { ...word, fontSize: 12, color: '#7dffb5', textShadow: OK_GLOW, marginTop: 6 } : { ...dim, fontSize: 12, marginTop: 6 }}>{focus.state === 'matched' ? '✓ Matched' : 'Read from the label'}</div>
          </div>
        )}
      </div>

      {facts.length > 0 && [left, right].map((col, side) => (
        <div key={`${sideKey}-${side}`} style={{ position: 'absolute', top: '28%', bottom: 92, overflowY: 'auto', overscrollBehavior: 'contain', [side ? 'right' : 'left']: 12, width: '31vw', maxWidth: 230, textAlign: side ? 'right' : 'left', pointerEvents: 'auto' }}>
          {col.map(([label, value], i) => (
            <div key={`${label}-${value}`} className="hd-fly" style={{ marginBottom: 14, animation: `${side ? 'hdFlyR' : 'hdFlyL'} .55s cubic-bezier(.2,.8,.2,1) both`, animationDelay: `${(i * 2 + side) * 0.11}s` }}>
              <div style={{ ...dim, fontSize: 9, letterSpacing: 0.5 }}>{label}</div>
              <div style={{ ...word, fontSize: 12, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{value}</div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 22px max(18px, env(safe-area-inset-bottom))' }}>
        {note ? <div style={{ ...dim, fontSize: 13, textAlign: 'center', marginBottom: 8 }}>{note}</div> : null}
        <div style={{ height: 1, background: '#4f8bff', boxShadow: '0 0 8px #2b56f0', opacity: 0.7, marginBottom: 10 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ ...word, fontSize: 17 }}>{[tally.length || !menuItems ? `${tally.length} read` : '', unsure ? `${unsure} unsure` : '', menuItems ? `${menuItems} menu items` : ''].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 18 }}>
            {menuPages.length > 0 && <div role="button" aria-label="Keep the menu" style={{ ...word, fontSize: 17, cursor: 'pointer', padding: '8px 0' }} onClick={keepMenu}>Keep menu</div>}
            {tally.length > 0 && <div role="button" aria-label="Review bottles" style={{ ...word, fontSize: 17, cursor: 'pointer', padding: '8px 0' }} onClick={() => setReview(true)}>Review</div>}
          </div>
        </div>
      </div>

      {review && (
        <div style={{ ...fill, background: 'rgba(4,10,40,.9)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ padding: 'max(22px, env(safe-area-inset-top)) 22px 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ ...word, fontSize: 24 }}>Bottles read</div>
              <div role="button" style={{ ...word, fontSize: 15, cursor: 'pointer', padding: 8 }} onClick={() => setReview(false)}>Back</div>
            </div>
            <div style={{ marginTop: 14 }}>
              {tally.map(b => (
                <div key={keyOf(b)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid rgba(79,139,255,.45)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...word, fontSize: 16 }}>{nameOf(b)}</div>
                    <div style={{ ...dim, fontSize: 12, marginTop: 3 }}>{[CATEGORY[b.category], text(b.details?.vintage), text(b.details?.classification), b.proof].filter(Boolean).join(' · ') || 'Read from the label'}</div>
                  </div>
                  <div role="button" aria-label={`Remove ${nameOf(b)}`} style={{ ...word, fontSize: 22, cursor: 'pointer', padding: '4px 10px' }} onClick={() => setRemoved(prev => ({ ...prev, [keyOf(b)]: true }))}>×</div>
                </div>
              ))}
            </div>
            <input value={venue} onChange={e => setVenue(e.target.value)} maxLength={120} placeholder="Where are you? The Dove Bar" aria-label="Venue name"
              style={{ ...word, fontSize: 16, width: '100%', marginTop: 24, padding: '10px 0', background: 'transparent', border: 'none', borderBottom: '1px solid #4f8bff', outline: 'none', borderRadius: 0, boxSizing: 'border-box' }} />
            <div role="button" style={{ ...word, fontSize: 20, marginTop: 26, cursor: 'pointer', opacity: tally.length && !saving ? 1 : 0.45, padding: '8px 0' }} onClick={save}>
              {saving ? 'Saving…' : `Save ${tally.length} bottle${tally.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
