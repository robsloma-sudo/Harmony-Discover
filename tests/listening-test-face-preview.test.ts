import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACE_DEMO_LINES } from '../src/listeningTest/logic';

const screen = () => readFileSync('app/listening-test.tsx', 'utf8');

describe('face preview', () => {
  it('has the two demo lines', () => {
    expect(FACE_DEMO_LINES.map(l => l.id)).toEqual(['annoyed', 'sarcastic']);
    expect(FACE_DEMO_LINES[0].label).toBe('Annoyed line');
    expect(FACE_DEMO_LINES[0].text).toContain('forty-dollar single malt');
    expect(FACE_DEMO_LINES[1].text).toContain('vodka soda');
  });
  it('screen source has the preview, the real option B path and no placeholder', () => {
    const src = screen();
    for (const s of ['FACE PREVIEW', 'LiveFace', 'Start B', 'onVoiceStream', "face: 'photo'", 'startFaceB', 'muteOutput', 'connectElevenLabsWs', 'pushSpeechMarks', 'onVoicePcm16k']) expect(src).toContain(s);
    expect(src).not.toContain('discover-face-live');
    expect(src).not.toContain('faceBClient');
    expect(existsSync('src/listeningTest/faceBClient.ts')).toBe(false);
  });
  it('loads the face SDK lazily, only inside faceB.ts', () => {
    const faceB = readFileSync('src/listeningTest/faceB.ts', 'utf8');
    expect(faceB).toContain("await import('@anam-ai/js-sdk')");
    expect(faceB).not.toMatch(/^import .*@anam-ai/m);
    expect(screen()).not.toContain('@anam-ai');
  });
  it('guests keep PhotoFace', () => {
    expect(readFileSync('src/marty/MartyFace.tsx', 'utf8')).toContain('PhotoFace');
  });
});

describe('option B never opens its own microphone', () => {
  it('createClient is called with disableInputAudio: true', () => {
    expect(readFileSync('src/listeningTest/faceB.ts', 'utf8')).toMatch(/createClient\(sessionToken, \{ disableInputAudio: true \}\)/);
  });
});
