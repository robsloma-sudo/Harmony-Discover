"""Cut Marty face L (assets/marty/marty-l.jpg, 416x416) into option A rig pieces.

Every piece is a small offline warp of the same photo (mouth shapes, squint, scowl, brows up, one brow), cut out with
soft edges and shown by weight at run time (src/marty/faceRig/rigLayout.ts). Re-run: python3 scripts/marty-face-rig.py
Writes assets/marty/rig/*.webp and prints the boxes (copy them into src/marty/faceRig/rigLayout.ts).
"""
import json, os, sys
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/marty/marty-l.jpg')
OUT = os.path.join(ROOT, 'assets/marty/rig')
os.makedirs(OUT, exist_ok=True)
img = cv2.cvtColor(cv2.imread(SRC), cv2.COLOR_BGR2RGB).astype(np.float32)
H, W = img.shape[:2]
Y, X = np.mgrid[0:H, 0:W].astype(np.float32)

def bump(cx, cy, sx, sy, ax, ay):
    g = np.exp(-(((X - cx) / sx) ** 2 + ((Y - cy) / sy) ** 2) / 2)
    return ax * g, ay * g

def warp(bumps):
    dx = np.zeros_like(X); dy = np.zeros_like(Y)
    for b in bumps:
        bx, by = bump(*b); dx += bx; dy += by
    # backward map; displacements are small so this is a good forward approximation
    return cv2.remap(img, X - dx, Y - dy, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)

def ramp(n, f):
    t = np.clip(np.arange(n, dtype=np.float32) / max(f, 1), 0, 1)
    return t * t * (3 - 2 * t)

def feather(w, h, l, t, r, b):
    ax = np.minimum(ramp(w, l), ramp(w, r)[::-1]); ay = np.minimum(ramp(h, t), ramp(h, b)[::-1])
    return np.outer(ay, ax)

boxes = {}
def save(name, src, x0, y0, x1, y1, fl, ft, fr, fb, colors=256):
    crop = src[y0:y1, x0:x1]
    a = feather(x1 - x0, y1 - y0, fl, ft, fr, fb)
    rgba = np.dstack([np.clip(crop, 0, 255), a * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    # WebP keeps the photo grain and the soft edges; 256-colour PNG made the skin blotchy.
    im.save(os.path.join(OUT, f'{name}.webp'), 'WEBP', quality=86, method=6)
    boxes[name] = [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H]

EYE_L, EYE_R = (162, 199), (265, 191)
BROW_L, BROW_R = (160, 178), (268, 170)

# expression pieces (offline warps)
squint = warp([
    (*EYE_L[:1], EYE_L[1] - 7, 22, 6, 0, 4.5), (EYE_L[0], EYE_L[1] + 10, 22, 6, 0, -3.5),
    (EYE_R[0], EYE_R[1] - 7, 22, 6, 0, 4.5), (EYE_R[0], EYE_R[1] + 10, 22, 6, 0, -3.5),
])
save('squint', squint, 118, 180, 312, 234, 14, 8, 14, 12)
scowl = warp([
    (*BROW_L, 30, 9, 1.5, 5), (*BROW_R, 30, 9, -1.5, 5),
    (199, 182, 10, 8, 3.5, 3), (231, 176, 10, 8, -3.5, 3),
    (EYE_L[0], EYE_L[1] - 9, 20, 4, 0, 1.6), (EYE_R[0], EYE_R[1] - 9, 20, 4, 0, 1.6),
])
save('scowl', scowl, 104, 140, 320, 200, 14, 14, 14, 10)
brows_up = warp([(*BROW_L, 30, 10, 0, -8), (*BROW_R, 30, 10, 0, -8), (EYE_L[0], EYE_L[1] - 9, 18, 4, 0, -1.2), (EYE_R[0], EYE_R[1] - 9, 18, 4, 0, -1.2)])
save('brows-up', brows_up, 104, 136, 320, 200, 14, 14, 14, 10)
brow_one = warp([(BROW_R[0] + 6, BROW_R[1] - 1, 26, 10, 0, -10), (BROW_R[0] + 26, BROW_R[1] + 2, 14, 8, 0, -4), (EYE_R[0], EYE_R[1] - 9, 18, 4, 0, -1.5)])
save('brow-one', brow_one, 218, 134, 320, 200, 14, 14, 12, 10)

print(json.dumps({k: [round(v, 4) for v in b] for k, b in boxes.items()}, indent=1))
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('total bytes', tot, file=sys.stderr)


# ---------------------------------------------------------------------------------------------------------------
# Mouth shapes: forward warps of the whole lower face (lips, jaw, chin and cheeks move together) with the inside of
# the mouth painted in. Shown by weight at run time (see rigLayout.ts mouthWeights).
CX = 222.0
def seam(x):  # lip line, measured on face L: lower at Marty's right corner, higher at his left
    return 312.0 - (x - 175.0) * 10.0 / 105.0

def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def lens(x, hw):
    return np.clip(1 - ((x - CX) / hw) ** 2, 0, 1) ** 0.8

MOUTH = (110, 258, 334, 416)
SHAPES = {
    # name: jaw drop px, upper lip lift px, corner move px (+out, -in), upper teeth 0..1, lower teeth, tongue, half width of the opening
    'press':  dict(J=-1.6, U=-1.2, Wd=1.5, teeth=0, low=0, tongue=0, hw=0),
    'teeth':  dict(J=5.0, U=2.6, Wd=4.0, teeth=1, low=0.6, tongue=0, hw=40),
    'open':   dict(J=12.0, U=3.2, Wd=1.5, teeth=0.8, low=0.2, tongue=0.5, hw=42),
    'wide':   dict(J=20.0, U=4.0, Wd=0.0, teeth=0.7, low=0.3, tongue=0.7, hw=44),
    'round':  dict(J=11.0, U=3.0, Wd=-8.0, teeth=0.3, low=0, tongue=0.4, hw=26),
    'pucker': dict(J=5.0, U=2.0, Wd=-11.0, teeth=0, low=0, tongue=0, hw=16),
    'ee':     dict(J=4.5, U=2.4, Wd=7.5, teeth=1, low=0.8, tongue=0, hw=50),
    'fv':     dict(J=0.5, U=3.0, Wd=2.0, teeth=1, low=0, tongue=0, hw=34),
}

def mouth_shape(p):
    J, U, Wd, hw = p['J'], p['U'], p['Wd'], p['hw']
    sy = seam(X)
    hwf = hw if hw else 40
    below = Y >= sy
    lip_l = J * lens(X, hwf) if hw else J * np.exp(-((X - CX) / 34) ** 2 / 2)
    chin = J * 0.92 * np.exp(-((X - CX) / 45) ** 2 / 2)
    w = smooth(6, 30, Y - sy)
    dy_low = ((1 - w) * lip_l + w * chin) * (1 - smooth(404, 416, Y))
    lip_u = U * (lens(X, hwf) if hw else np.exp(-((X - CX) / 34) ** 2 / 2))
    dy_up = -lip_u * (1 - smooth(0, 26, sy - Y))
    dy = np.where(below, dy_low, dy_up)
    side = np.clip((X - CX) / 57.0, -1.4, 1.4)
    dx = Wd * side * np.exp(-((Y - sy) / 16) ** 2 / 2) * np.exp(-((np.abs(X - CX) - 57) / 30).clip(0) ** 2 / 2)
    # cheeks: stretch down when the jaw drops, lift when the lips go wide
    for (cx, cy) in ((150, 282), (292, 274)):
        g = np.exp(-(((X - cx) / 20) ** 2 + ((Y - cy) / 18) ** 2) / 2)
        dy += g * (0.25 * max(J, 0) - 0.35 * max(Wd, 0))
        dx += g * (np.sign(cx - CX) * 0.3 * max(Wd, 0))
    # invert the forward field: find source s with s + d(s) = dest (fixed point)
    sx_, sy_ = X.copy(), Y.copy()
    for _ in range(14):
        ddx = cv2.remap(dx.astype(np.float32), sx_, sy_, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        ddy = cv2.remap(dy.astype(np.float32), sx_, sy_, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        sx_, sy_ = X - ddx, Y - ddy
    out = cv2.remap(img, sx_, sy_, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    if hw and J > 0:
        # moved lip edges, in destination space (corners follow the horizontal move a little)
        xs = X - Wd * np.clip((X - CX) / 57.0, -1.4, 1.4) * 0.0
        top = seam(xs) - U * lens(xs, hw)
        bot = seam(xs) + J * lens(xs, hw)
        cover = np.clip(np.minimum(Y - top, bot - Y) / 1.3 + 0.35, 0, 1) * smooth(0, 0.08, lens(xs, hw))
        gap = np.maximum(bot - top, 1e-3)
        f = np.clip((Y - top) / gap, 0, 1)  # 0 at the upper lip, 1 at the lower lip
        inside = np.dstack([np.full_like(X, 34), np.full_like(X, 13), np.full_like(X, 12)])
        dark = 0.55 + 0.45 * np.abs(f - 0.5) * 2  # darker in the middle (depth)
        col = inside * (1.0 - 0.45 * (1 - dark))[..., None]
        if p['tongue']:
            t = smooth(0.55, 0.9, f) * p['tongue'] * lens(xs, hw * 0.75)
            col = col * (1 - t[..., None] * 0.8) + np.dstack([np.full_like(X, 120), np.full_like(X, 52), np.full_like(X, 52)]) * (t[..., None] * 0.8)
        th = np.minimum(gap * 0.5, 7.0) * p['teeth']
        tt = (1 - smooth(th - 1.4, th + 0.2, Y - top)) * lens(xs, hw * 0.82) ** 0.5 * p['teeth'] * 0.85
        shade = 0.62 + 0.38 * smooth(0, 1, (Y - top) / np.maximum(th, 1e-3)) * lens(xs, hw) ** 0.5  # in the lip's shadow at the top and the sides
        seams = 1 - 0.1 * np.exp(-((((X - CX) / 8.0) % 1 - 0.5) / 0.09) ** 2)
        teeth = np.dstack([np.full_like(X, 196), np.full_like(X, 182), np.full_like(X, 160)]) * (shade * seams)[..., None]
        col = col * (1 - tt[..., None]) + teeth * tt[..., None]
        if p['low']:
            lh = np.minimum(gap * 0.25, 3.0) * p['low']
            lt = (1 - smooth(lh - 1.2, lh + 0.2, bot - Y)) * lens(xs, hw * 0.6) ** 0.5 * p['low'] * 0.6
            col = col * (1 - lt[..., None]) + teeth * 0.85 * lt[..., None]
        col = cv2.GaussianBlur(col.astype(np.float32), (0, 0), 0.6)
        out = out * (1 - cover[..., None]) + col * cover[..., None]
    if p['teeth'] and J <= 1:  # f/v: top teeth resting on the lower lip
        xs = X
        top = seam(xs) - U * lens(xs, p['hw'])
        th = U * 0.9
        tt = smooth(-0.6, 0.6, Y - top) * (1 - smooth(th - 1.2, th + 0.2, Y - top)) * lens(xs, p['hw'] * 0.85) ** 0.5
        teeth = np.dstack([np.full_like(X, 178), np.full_like(X, 165), np.full_like(X, 146)])
        out = out * (1 - tt[..., None] * 0.9) + teeth * tt[..., None] * 0.9
    return out

for name, p in SHAPES.items():
    save(f'mouth-{name}', mouth_shape(p), *MOUTH, 16, 16, 16, 0)
print(json.dumps({k: [round(v, 4) for v in b] for k, b in boxes.items() if k.startswith('mouth')}), file=sys.stderr)
