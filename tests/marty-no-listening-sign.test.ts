// P-20261125-1654 part 3: Rob wants only Marty's round talking face, no red "LISTENING" box or sign.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { microphoneLive } from '../src/marty/faceState';

const overlay = readFileSync(join(__dirname, '../src/marty/MartyOverlay.tsx'), 'utf8');
const code = overlay.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('Marty shows only his face, no listening sign', () => {
  it('has no LISTENING / MICROPHONE ON text anywhere on screen', () => {
    expect(code).not.toMatch(/LISTENING/);
    expect(code).not.toMatch(/MICROPHONE ON/);
    expect(code).not.toMatch(/MICROPHONE OFF'/);
  });
  it('the red badge, pill and sign styles are gone, and the button border no longer turns red', () => {
    for (const name of ['fabBadge', 'fabLive', 'micSign', 'marty-listening-pill', 's.pill']) expect(code).not.toContain(name);
  });
  it('while another sheet is open and the mic is on, only his small face shows (tap still turns him off)', () => {
    expect(code).toMatch(/testID="marty-listening-face"[^>]*onPress=\{turnMartyOff\}/);
    expect(microphoneLive({ connected: true, handsFree: true, phase: 'idle' })).toBe(true);
  });
  it('the Stop button still stops the session and the off switch still turns Marty off', () => {
    expect(code).toMatch(/testID="marty-stop"[\s\S]*?onPress=\{\(\) => void voice\.stop\(\)\}/);
    expect(code).toMatch(/testID="marty-off-switch"[\s\S]*?turnMartyOff\(\)/);
  });
});
