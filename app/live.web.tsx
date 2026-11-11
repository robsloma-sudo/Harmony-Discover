import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { router } from 'expo-router';
import { readLiveFrame, saveBottleSightings, bottleErrorMessage, type BottleRead, type MenuGlimpse } from '../src/services/discoverLiveApi';
import { useScan } from '../src/state/ScanContext';

// One live scanner for everything: bottles (beer, wine, spirits) and menus. Browser tier.
// Two things run at once:
//   1. On the phone, many times a second: every edge in the live picture (bottle curve, cork, label, lettering)
//      is found and drawn as a glowing line. It is redrawn from the camera each time, so it stays on the
//      bottle however the phone moves. A neon line sweeps up and down and reveals those edges as it passes.
//   2. About once a second, when the view is steady: one frame goes to discover-bottle-read, which returns
//      what is printed on each label and any menu in view. That data is thrown out to the sides of the screen.
//      A menu is then captured into the existing menu flow (review, corrections, consent) with one tap.
// Look: Harmony Journeys. Glowing words, no boxes.

const GLOW = '0 1px 2px rgba(0,10,40,.8),0 0 6px #4f8bff,0 0 14px #2b56f0,0 0 28px #1d3fd8';
const AMBER_GLOW = '0 1px 2px rgba(40,20,0,.8),0 0 8px rgba(255,200,90,.6)';
const OK_GLOW = '0 0 8px rgba(70,255,160,.55)';
const word: CSSProperties = { color: '#f2f8ff', textShadow: GLOW, fontWeight: 700, fontFamily: "'Space Grotesk',system-ui,-apple-system,sans-serif", letterSpacing: 0.2 };
const dim: CSSProperties = { ...word, color: '#d3e3ff', fontWeight: 500 };
const EDGE_W = 168, SWEEP_MS = 2300, READ_GAP_MS = 1300;

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

export default function Live() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const edgeRef = useRef<HTMLCanvasElement | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const session = useMemo(() => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '00000000-0000-4000-8000-000000000000'), []);

  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'unsupported'>('starting');
  const { addPages } = useScan();
  const [bottles, setBottles] = useState<BottleRead[]>([]);
  const [menu, setMenu] = useState<MenuGlimpse | null>(null);
  const [tally, setTally] = useState<Record<string, BottleRead>>({});
  const [reading, setReading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const [venue, setVenue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { pausedRef.current = review; }, [review]);

  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, alive = true, busy = false;
    let lastRead = 0, motionSince = 999, lastResultAt = 0, frameNo = 0, lastRow = -1, movingNow = false;
    let prevGray: Uint8ClampedArray | null = null, revealed: Float32Array | null = null;
    const work = document.createElement('canvas'), shot = document.createElement('canvas');
    const t0 = performance.now();

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = videoRef.current!; v.srcObject = stream; await v.play().catch(() => undefined);
        setStatus('scanning'); raf = requestAnimationFrame(tick);
      } catch { setStatus('denied'); }
    }

    /** Source rectangle of the video that is actually on screen (the video is shown "cover"). */
    function crop(v: HTMLVideoElement, W: number, H: number) {
      const s = Math.max(W / v.videoWidth, H / v.videoHeight), sw = W / s, sh = H / s;
      return { sx: (v.videoWidth - sw) / 2, sy: (v.videoHeight - sh) / 2, sw, sh };
    }

    function tick(now: number) {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const v = videoRef.current, stage = stageRef.current, edge = edgeRef.current;
      if (!v || !stage || !edge || !v.videoWidth) return;
      const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;

      // the sweep line: up and down the whole screen
      let p = ((now - t0) / SWEEP_MS) % 2; p = p < 1 ? p : 2 - p; p = p * p * (3 - 2 * p);
      if (lineRef.current) lineRef.current.style.transform = `translateY(${Math.round(p * (H - 3))}px)`;

      frameNo += 1; if (frameNo % 2) return;   // edges at half the display rate
      const EW = EDGE_W, EH = Math.max(120, Math.min(380, Math.round(EW * H / W)));
      if (work.width !== EW || work.height !== EH) { work.width = EW; work.height = EH; edge.width = EW; edge.height = EH; prevGray = null; revealed = new Float32Array(EH); lastRow = -1; }
      const c = crop(v, W, H), wctx = work.getContext('2d', { willReadFrequently: true })!, ectx = edge.getContext('2d')!;
      wctx.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, EW, EH);
      const px = wctx.getImageData(0, 0, EW, EH).data, n = EW * EH, gray = new Uint8ClampedArray(n);
      for (let i = 0, j = 0; i < n; i += 1, j += 4) gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;

      // how much the picture moved since the last edge frame
      let motion = 0;
      if (prevGray) { let sum = 0, cnt = 0; for (let i = 0; i < n; i += 7) { sum += Math.abs(gray[i] - prevGray[i]); cnt += 1; } motion = sum / cnt; }
      prevGray = gray; motionSince += motion;
      const isMoving = motion > 9; if (isMoving !== movingNow) { movingNow = isMoving; setMoving(isMoving); }

      // reveal the rows the line has passed
      const row = Math.round(p * (EH - 1)), rv = revealed!;
      if (lastRow < 0) lastRow = row;
      for (let y = Math.min(row, lastRow); y <= Math.max(row, lastRow); y += 1) rv[y] = 1;
      lastRow = row;

      const out = ectx.createImageData(EW, EH), o = out.data;
      for (let y = 1; y < EH - 1; y += 1) {
        const near = Math.abs(y - row) < 4 ? 1.9 : 1, shown = rv[y];
        if (!shown) continue;
        for (let x = 1; x < EW - 1; x += 1) {
          const i = y * EW + x;
          const gx = -gray[i - EW - 1] - 2 * gray[i - 1] - gray[i + EW - 1] + gray[i - EW + 1] + 2 * gray[i + 1] + gray[i + EW + 1];
          const gy = -gray[i - EW - 1] - 2 * gray[i - EW] - gray[i - EW + 1] + gray[i + EW - 1] + 2 * gray[i + EW] + gray[i + EW + 1];
          const m = (Math.abs(gx) + Math.abs(gy)) * near;
          if (m < 96) continue;
          const a = Math.min(255, (m - 96) * 2.4), k = i * 4;
          o[k] = 226; o[k + 1] = 238; o[k + 2] = 255; o[k + 3] = a;
        }
      }
      ectx.putImageData(out, 0, 0);

      // one steady frame to Harmony, about once a second, only when the view has changed
      const steady = motion < 7, fresh = motionSince > 22 || now - lastResultAt > 6000;
      if (!busy && !pausedRef.current && !document.hidden && steady && fresh && now - lastRead > READ_GAP_MS) {
        busy = true; lastRead = now; motionSince = 0; setReading(true);
        const long = 720, sw2 = W >= H ? long : Math.round(long * W / H), sh2 = W >= H ? Math.round(long * H / W) : long;
        shot.width = sw2; shot.height = sh2; shot.getContext('2d')!.drawImage(v, c.sx, c.sy, c.sw, c.sh, 0, 0, sw2, sh2);
        const b64 = shot.toDataURL('image/jpeg', 0.72).replace(/^data:image\/jpeg;base64,/, '');
        readLiveFrame(b64).then(result => {
          if (!alive) return;
          const found = result.bottles;
          lastResultAt = performance.now(); setNote(''); setBottles(found); setMenu(result.menu.visible ? result.menu : null);
          setTally(prev => { const next = { ...prev }; for (const b of found) { if (b.state !== 'unsure' && keyOf(b)) next[keyOf(b)] = b; } return next; });
        }).catch(error => { if (alive) setNote(bottleErrorMessage(error)); })
          .finally(() => { busy = false; if (alive) setReading(false); });
      }
    }

    start();
    return () => { alive = false; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  const read = Object.values(tally);
  const unsure = bottles.filter(b => b.state === 'unsure').length;
  const focus = useMemo(() => {
    const named = bottles.filter(b => b.state !== 'unsure');
    return named.sort((a, b) => Math.abs((a.box.x0 + a.box.x1) / 2 - 0.5) - Math.abs((b.box.x0 + b.box.x1) / 2 - 0.5))[0] || null;
  }, [bottles]);
  const showMenu = !focus && !!menu;
  const facts: Array<[string, string]> = focus ? factsOf(focus) : showMenu ? menu!.items.slice(0, 12).map(it => [it.price || it.type, it.name] as [string, string]) : [];
  const sideKey = focus ? keyOf(focus) : showMenu ? `menu-${menu!.items.length}-${menu!.items[0]?.name || ''}` : '';
  const left = facts.filter((_, i) => i % 2 === 0), right = facts.filter((_, i) => i % 2 === 1);

  /** Hands the current view to the existing menu flow: review, corrections and consent all happen there. */
  function captureMenu() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 2000 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    addPages([c.toDataURL('image/jpeg', 0.88)], 'camera');
    router.push('/preview');
  }

  async function save() {
    if (!read.length || saving) return;
    setSaving(true);
    try {
      const result = await saveBottleSightings(session, venue.trim(), read);
      setTally({}); setReview(false); setNote(`Saved ${result.saved} bottle${result.saved === 1 ? '' : 's'}`);
    } catch (error) { setNote(bottleErrorMessage(error)); }
    finally { setSaving(false); }
  }

  const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' };
  return (
    <div ref={stageRef} style={{ position: 'fixed', inset: 0, background: '#050a1c', overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none' }}>
      <style>{`
        @keyframes hdFlyL{from{opacity:0;transform:translate(38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdFlyR{from{opacity:0;transform:translate(-38vw,12vh) scale(.7)}to{opacity:1;transform:none}}
        @keyframes hdRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes hdPulse{0%,100%{opacity:.55}50%{opacity:1}}
        @media (prefers-reduced-motion: reduce){.hd-fly{animation:none!important}}
      `}</style>
      <video ref={videoRef} playsInline muted autoPlay style={{ ...fill, objectFit: 'cover' }} />
      <div style={{ ...fill, background: 'radial-gradient(ellipse at center,rgba(5,10,40,0) 40%,rgba(5,10,40,.5) 78%,rgba(5,10,40,.82) 100%)' }} />
      <canvas ref={edgeRef} aria-hidden style={{ ...fill, filter: 'drop-shadow(0 0 3px #4f8bff) drop-shadow(0 0 9px #2b56f0)', opacity: 0.95 }} />
      <div ref={lineRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: '#bcd4ff', boxShadow: '0 0 8px 2px #4f8bff,0 0 22px 6px #2b56f0,0 0 46px 10px #1d3fd8', willChange: 'transform' }} />

      {bottles.map((b, i) => {
        const cx = ((b.box.x0 + b.box.x1) / 2) * 100, top = Math.max(15, b.box.y0 * 100 - 4);
        const isUnsure = b.state === 'unsure';
        return (
          <div key={`${keyOf(b) || 'u'}-${i}`} style={{ position: 'absolute', left: `${cx}%`, top: `${top}%`, transform: 'translate(-50%,-100%)', textAlign: 'center', pointerEvents: 'none', opacity: moving ? 0.25 : 1, transition: 'opacity .25s', animation: 'hdRise .35s ease-out both', maxWidth: '44vw' }}>
            <div style={isUnsure ? { ...word, color: '#ffd27a', textShadow: AMBER_GLOW, fontSize: 13, animation: 'hdPulse 1.1s ease-in-out infinite' } : { ...word, fontSize: 14 }}>{isUnsure ? 'Reading…' : nameOf(b)}</div>
          </div>
        );
      })}

      <div style={{ position: 'absolute', left: 16, top: 'max(14px, env(safe-area-inset-top))', ...word, fontSize: 16, cursor: 'pointer', padding: '8px 4px' }} role="button" aria-label="Back" onClick={() => (router.canGoBack() ? router.back() : router.replace('/'))}>‹ Back</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 'max(22px, calc(env(safe-area-inset-top) + 8px))', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ ...dim, fontSize: 13, animation: reading ? 'hdPulse 1s ease-in-out infinite' : undefined }}>
          {status === 'starting' ? 'Starting the camera…' : status === 'scanning' ? 'Harmony is reading' : ''}
        </div>
        {showMenu && (
          <div key={sideKey} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}>
            <div style={{ ...word, fontSize: 26, lineHeight: 1.15 }}>{menu!.title || 'Menu'}</div>
            <div style={{ ...dim, fontSize: 12, marginTop: 6 }}>Tap Capture menu to keep it</div>
          </div>
        )}
        {focus && (
          <div key={keyOf(focus)} style={{ marginTop: 16, animation: 'hdRise .4s ease-out both', padding: '0 20px' }}>
            <div style={{ ...word, fontSize: 26, lineHeight: 1.15 }}>{nameOf(focus)}</div>
            <div style={focus.state === 'matched' ? { ...word, fontSize: 12, color: '#7dffb5', textShadow: OK_GLOW, marginTop: 6 } : { ...dim, fontSize: 12, marginTop: 6 }}>{focus.state === 'matched' ? '✓ Matched' : 'Read from the label'}</div>
          </div>
        )}
      </div>

      {facts.length > 0 && [left, right].map((col, side) => (
        <div key={`${sideKey}-${side}`} style={{ position: 'absolute', top: '30%', [side ? 'right' : 'left']: 12, width: '31vw', maxWidth: 190, textAlign: side ? 'right' : 'left', pointerEvents: 'none' }}>
          {col.slice(0, 6).map(([label, value], i) => (
            <div key={`${label}-${value}`} className="hd-fly" style={{ marginBottom: 14, animation: `${side ? 'hdFlyR' : 'hdFlyL'} .55s cubic-bezier(.2,.8,.2,1) both`, animationDelay: `${(i * 2 + side) * 0.11}s` }}>
              <div style={{ ...dim, fontSize: 10, letterSpacing: 0.6 }}>{label}</div>
              <div style={{ ...word, fontSize: 14, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{value}</div>
            </div>
          ))}
        </div>
      ))}

      {(status === 'denied' || status === 'unsupported') && (
        <div style={{ ...fill, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', background: 'rgba(4,10,40,.86)' }}>
          <div style={{ ...word, fontSize: 22 }}>{status === 'denied' ? 'Camera access is off' : "This browser can't open the camera"}</div>
          <div style={{ ...dim, fontSize: 14, marginTop: 12, lineHeight: 1.5 }}>{status === 'denied' ? 'Allow the camera for this site in your browser settings, then reload.' : 'Open Discover in Safari or Chrome on your phone.'}</div>
        </div>
      )}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '0 22px max(18px, env(safe-area-inset-bottom))' }}>
        {note ? <div style={{ ...dim, fontSize: 13, textAlign: 'center', marginBottom: 10 }}>{note}</div> : null}
        <div style={{ height: 1, background: '#4f8bff', boxShadow: '0 0 8px #2b56f0', opacity: 0.7, marginBottom: 12 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ ...word, fontSize: 18 }}>{showMenu ? `${menu!.items.length} menu item${menu!.items.length === 1 ? '' : 's'}` : `${read.length} read${unsure ? ` · ${unsure} unsure` : ''}`}</div>
          {showMenu
            ? <div role="button" aria-label="Capture this menu" style={{ ...word, fontSize: 18, cursor: 'pointer', padding: '8px 0 8px 16px' }} onClick={captureMenu}>Capture menu</div>
            : <div role="button" aria-label="Review bottles" style={{ ...word, fontSize: 18, cursor: 'pointer', padding: '8px 0 8px 16px', opacity: read.length ? 1 : 0.45 }} onClick={() => read.length && setReview(true)}>Review</div>}
        </div>
      </div>

      {review && (
        <div style={{ ...fill, background: 'rgba(4,10,40,.88)', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ padding: 'max(22px, env(safe-area-inset-top)) 22px 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ ...word, fontSize: 24 }}>Bottles read</div>
              <div role="button" style={{ ...word, fontSize: 15, cursor: 'pointer', padding: 8 }} onClick={() => setReview(false)}>Keep scanning</div>
            </div>
            <div style={{ marginTop: 14 }}>
              {read.map(b => (
                <div key={keyOf(b)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid rgba(79,139,255,.45)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...word, fontSize: 16 }}>{nameOf(b)}</div>
                    <div style={{ ...dim, fontSize: 12, marginTop: 3 }}>{[CATEGORY[b.category], text(b.details?.vintage), text(b.details?.classification), b.proof].filter(Boolean).join(' · ') || 'Read from the label'}</div>
                  </div>
                  <div role="button" aria-label={`Remove ${nameOf(b)}`} style={{ ...word, fontSize: 22, cursor: 'pointer', padding: '4px 10px' }} onClick={() => setTally(prev => { const next = { ...prev }; delete next[keyOf(b)]; return next; })}>×</div>
                </div>
              ))}
            </div>
            <input value={venue} onChange={e => setVenue(e.target.value)} maxLength={120} placeholder="Where are you? The Dove Bar" aria-label="Venue name"
              style={{ ...word, fontSize: 16, width: '100%', marginTop: 24, padding: '10px 0', background: 'transparent', border: 'none', borderBottom: '1px solid #4f8bff', outline: 'none', borderRadius: 0, boxSizing: 'border-box' }} />
            <div role="button" style={{ ...word, fontSize: 20, marginTop: 26, cursor: 'pointer', opacity: read.length && !saving ? 1 : 0.45, padding: '8px 0' }} onClick={save}>
              {saving ? 'Saving…' : `Save ${read.length} bottle${read.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
