// Face "L": photo-real Marty (original, fictional). Base photo + jaw piece that drops over a dark mouth gap + blink lids.
import { useEffect, useRef } from 'react';
import { Animated, Image, Platform, View } from 'react-native';
import type { MartyFaceComponent } from '../faceTypes';
import {
  BLINK_BOX, GAP_CENTER_X, GAP_COLOR, GAP_TOP_Y, GAP_WIDTH, GOLD, JAW_BOX, LISTENING_RED, PHOTO_SCALE, POSES,
  clampOpen, gapHeight, jawShift, ringWidth,
} from './photoFaceLayout';

const native = Platform.OS !== 'web';
const BASE = require('../../../assets/marty/marty-l.jpg');
const JAW = require('../../../assets/marty/marty-l-jaw.png');
const BLINK = require('../../../assets/marty/marty-l-blink.png');

function timing(v: Animated.Value, toValue: number, duration: number, useNativeDriver = native) {
  return Animated.timing(v, { toValue, duration, useNativeDriver });
}

export const PhotoFace: MartyFaceComponent = ({ state, mouthOpen, size }) => {
  // native-driven values
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const pose = useRef(new Animated.Value(0)).current; // scale of the pose
  const tilt = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const dots = useRef(new Animated.Value(0)).current;
  // JS-driven value (layout props), never shared with the above
  const mo = useRef(new Animated.Value(0)).current;
  const poseInit = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([timing(breathe, 1, 2200), timing(breathe, 0, 2200)]));
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const blinks = POSES[state].blinks;
  useEffect(() => {
    if (!blinks) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anim: Animated.CompositeAnimation | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        anim = Animated.sequence([timing(blink, 1, 60), timing(blink, 0, 80)]);
        anim.start(() => { if (alive) schedule(); });
      }, 3000 + Math.random() * 2000);
    };
    schedule();
    return () => { alive = false; if (timer) clearTimeout(timer); anim?.stop(); blink.setValue(0); };
  }, [blinks, blink]);

  useEffect(() => {
    const p = POSES[state];
    if (!poseInit.current) { poseInit.current = true; pose.setValue(p.scale); tilt.setValue(p.tiltDeg); ring.setValue(p.ring); }
    const to = Animated.parallel([timing(pose, p.scale, 350), timing(tilt, p.tiltDeg, 350), timing(ring, p.ring, 300)]);
    to.start();
    let loop: Animated.CompositeAnimation | undefined;
    if (state === 'thinking') {
      dots.setValue(0);
      loop = Animated.loop(timing(dots, 1, 1500));
      loop.start();
    }
    return () => { to.stop(); loop?.stop(); };
  }, [state, pose, tilt, ring, dots]);

  // mouth follows the prop with light 50 ms smoothing (JS driver: layout props)
  useEffect(() => {
    const target = state === 'talking' ? clampOpen(mouthOpen) : 0;
    const a = timing(mo, target, state === 'talking' ? 50 : 150, false);
    a.start();
    return () => a.stop();
  }, [mouthOpen, state, mo]);

  const s = size;
  const abs = { position: 'absolute' as const };
  const pivot = 0.3 * s; // tilt around the shoulders
  const gapW = GAP_WIDTH * s;
  const maxShift = jawShift(1, s);
  const gapH = mo.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, gapHeight(0.001, s), gapHeight(1, s)] });
  const jawY = mo.interpolate({ inputRange: [0, 1], outputRange: [0, maxShift] });
  const rw = ringWidth(s);
  const dotStyle = (i: number) => {
    const p = 0.2 + i * 0.25;
    return {
      opacity: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0.4, 0.4, 1, 0.4, 0.4] }),
      transform: [{ translateY: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0, 0, -0.012 * s, 0, 0] }) }],
    };
  };

  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, overflow: 'hidden', backgroundColor: '#0E1116' }} accessibilityLabel={`Marty, ${state}`}>
      <Animated.View style={[abs, { left: 0, top: 0, width: s, height: s, transform: [
        { translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 0.008 * s] }) },
        { scale: Animated.multiply(pose, breathe.interpolate({ inputRange: [0, 1], outputRange: [PHOTO_SCALE, PHOTO_SCALE * 1.012] })) },
        { translateY: pivot },
        { rotate: tilt.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
        { translateY: -pivot },
      ] }]}>
        <Image source={BASE} style={[abs, { left: 0, top: 0, width: s, height: s }]} resizeMode="cover" />
        {/* dark mouth gap, only visible once the jaw drops */}
        <Animated.View style={[abs, { left: (GAP_CENTER_X - GAP_WIDTH / 2) * s, top: GAP_TOP_Y * s, width: gapW, height: gapH,
          backgroundColor: GAP_COLOR, opacity: 0.92, borderRadius: gapHeight(1, s) / 2 }]} />
        <Animated.Image source={JAW} style={[abs, { left: JAW_BOX.x * s, top: JAW_BOX.y * s, width: JAW_BOX.w * s, height: JAW_BOX.h * s, transform: [{ translateY: jawY }] }]} resizeMode="stretch" />
        <Animated.Image source={BLINK} style={[abs, { left: BLINK_BOX.x * s, top: BLINK_BOX.y * s, width: BLINK_BOX.w * s, height: BLINK_BOX.h * s, opacity: blink }]} resizeMode="stretch" />
      </Animated.View>

      {/* listening ring + soft glow, inside the circle so it is never clipped */}
      <Animated.View pointerEvents="none" style={[abs, { left: 0, top: 0, width: s, height: s, borderRadius: s / 2, borderWidth: rw, borderColor: LISTENING_RED, backgroundColor: 'rgba(255,90,78,0.08)', opacity: ring }]} />

      {state === 'thinking' && [0, 1, 2].map(i => {
        const d = (0.05 + i * 0.01) * s;
        return <Animated.View key={i} pointerEvents="none" style={[abs, { left: (0.64 + i * 0.07) * s, top: (0.27 - i * 0.04) * s, width: d, height: d, borderRadius: d, backgroundColor: GOLD }, dotStyle(i)]} />;
      })}
    </View>
  );
};
