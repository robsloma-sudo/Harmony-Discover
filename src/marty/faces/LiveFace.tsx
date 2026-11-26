// Option A: face L with a full rig (P-20261126-0028). Mouth shapes follow the sounds of his voice; lips, jaw, chin and
// cheeks move together; brows and eyes follow his mood; nods, tilts, blinks and breathing keep him alive.
// Rob-only for now: guests keep PhotoFace (see MartyFace.tsx) until Rob approves.
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, View } from 'react-native';
import type { MartyFaceState } from '../faceTypes';
import { createFaceDriver, type FaceDriver } from '../faceRig/faceDriver';
import { MOUTH_SHAPES, type FacePose, type MouthShape } from '../faceRig/facePose';
import { BROW_BOXES, LIDS_BOX, MOUTH_BOX, SQUINT_BOX, browOpacities, headMove, mouthOpacities, type Box } from '../faceRig/rigLayout';
import { GOLD, LISTENING_RED, ringWidth } from './photoFaceLayout';

const BASE = require('../../../assets/marty/marty-l.jpg');
const LIDS = require('../../../assets/marty/marty-l-blink.png');
const MOUTH_SRC: Record<MouthShape, number> = {
  press: require('../../../assets/marty/rig/mouth-press.webp'),
  teeth: require('../../../assets/marty/rig/mouth-teeth.webp'),
  ee: require('../../../assets/marty/rig/mouth-ee.webp'),
  fv: require('../../../assets/marty/rig/mouth-fv.webp'),
  pucker: require('../../../assets/marty/rig/mouth-pucker.webp'),
  round: require('../../../assets/marty/rig/mouth-round.webp'),
  open: require('../../../assets/marty/rig/mouth-open.webp'),
  wide: require('../../../assets/marty/rig/mouth-wide.webp'),
};
const SCOWL = require('../../../assets/marty/rig/scowl.webp');
const BROWS_UP = require('../../../assets/marty/rig/brows-up.webp');
const BROW_ONE = require('../../../assets/marty/rig/brow-one.webp');
const SQUINT = require('../../../assets/marty/rig/squint.webp');

export interface LiveFaceProps { state: MartyFaceState; size: number; driver: FaceDriver | null }

const v = () => new Animated.Value(0);

export function LiveFace({ state, size, driver }: LiveFaceProps) {
  // Without a driver the face still breathes, blinks and drifts.
  const [own] = useState<FaceDriver | null>(() => (driver ? null : createFaceDriver()));
  useEffect(() => () => own?.dispose(), [own]);
  const d = driver ?? own;

  const mouth = useRef(Object.fromEntries(MOUTH_SHAPES.map(k => [k, v()])) as Record<MouthShape, Animated.Value>).current;
  const brow = useRef({ scowl: v(), browUp: v(), browOne: v() }).current;
  const squint = useRef(v()).current;
  const lids = useRef(v()).current;
  const head = useRef({ tx: v(), ty: v(), sc: new Animated.Value(1.06), rot: v() }).current;
  const ring = useRef(new Animated.Value(state === 'listening' ? 1 : 0)).current;
  const dots = useRef(v()).current;

  useEffect(() => { d?.setFaceState(state === 'talking' ? 'idle' : state); }, [d, state]);

  useEffect(() => {
    if (!d) return;
    const apply = (p: FacePose) => {
      const m = mouthOpacities(p);
      for (const k of MOUTH_SHAPES) mouth[k].setValue(m[k]);
      const b = browOpacities(p);
      brow.scowl.setValue(b.scowl); brow.browUp.setValue(b.browUp); brow.browOne.setValue(b.browOne);
      squint.setValue(Math.min(1, p.squint));
      lids.setValue(p.blink);
      const h = headMove(p, size);
      head.tx.setValue(h.translateX); head.ty.setValue(h.translateY); head.sc.setValue(h.scale); head.rot.setValue(h.rotateDeg);
    };
    apply(d.current());
    return d.subscribe(apply);
  }, [d, size, mouth, brow, squint, lids, head]);

  useEffect(() => {
    const a = Animated.timing(ring, { toValue: state === 'listening' ? 1 : 0, duration: 300, useNativeDriver: false });
    a.start();
    let loop: Animated.CompositeAnimation | undefined;
    if (state === 'thinking') { dots.setValue(0); loop = Animated.loop(Animated.timing(dots, { toValue: 1, duration: 1500, useNativeDriver: false })); loop.start(); }
    return () => { a.stop(); loop?.stop(); };
  }, [state, ring, dots]);

  const s = size;
  const abs = { position: 'absolute' as const };
  const at = (b: Box) => ({ left: b.x * s, top: b.y * s, width: b.w * s, height: b.h * s });
  const pivot = 0.3 * s;
  const rw = ringWidth(s);
  const dotStyle = (i: number) => {
    const p = 0.2 + i * 0.25;
    return {
      opacity: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0.4, 0.4, 1, 0.4, 0.4] }),
      transform: [{ translateY: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0, 0, -0.012 * s, 0, 0] }) }],
    };
  };

  return (
    <View testID="marty-live-face" style={{ width: s, height: s, borderRadius: s / 2, overflow: 'hidden', backgroundColor: '#0E1116' }} accessibilityLabel={`Marty, ${state}`}>
      <Animated.View style={[abs, { left: 0, top: 0, width: s, height: s, transform: [
        { translateX: head.tx },
        { translateY: head.ty },
        { scale: head.sc },
        { translateY: pivot },
        { rotate: head.rot.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
        { translateY: -pivot },
      ] }]}>
        <Image source={BASE} style={[abs, { left: 0, top: 0, width: s, height: s }]} resizeMode="cover" />
        {MOUTH_SHAPES.map(k => <Animated.Image key={k} source={MOUTH_SRC[k]} style={[abs, at(MOUTH_BOX), { opacity: mouth[k] }]} resizeMode="stretch" />)}
        <Animated.Image source={SCOWL} style={[abs, at(BROW_BOXES.scowl), { opacity: brow.scowl }]} resizeMode="stretch" />
        <Animated.Image source={BROWS_UP} style={[abs, at(BROW_BOXES.browUp), { opacity: brow.browUp }]} resizeMode="stretch" />
        <Animated.Image source={BROW_ONE} style={[abs, at(BROW_BOXES.browOne), { opacity: brow.browOne }]} resizeMode="stretch" />
        <Animated.Image source={SQUINT} style={[abs, at(SQUINT_BOX), { opacity: squint }]} resizeMode="stretch" />
        <Animated.Image source={LIDS} style={[abs, at(LIDS_BOX), { opacity: lids }]} resizeMode="stretch" />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[abs, { left: 0, top: 0, width: s, height: s, borderRadius: s / 2, borderWidth: rw, borderColor: LISTENING_RED, backgroundColor: 'rgba(255,90,78,0.08)', opacity: ring }]} />
      {state === 'thinking' && [0, 1, 2].map(i => {
        const dd = (0.05 + i * 0.01) * s;
        return <Animated.View key={i} pointerEvents="none" style={[abs, { left: (0.64 + i * 0.07) * s, top: (0.27 - i * 0.04) * s, width: dd, height: dd, borderRadius: dd, backgroundColor: GOLD }, dotStyle(i)]} />;
      })}
    </View>
  );
}
