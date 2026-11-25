// Option A, "the vest": Marty, an original older Boston bartender. Built only from Views + Animated (no SVG).
import { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { MartyFaceProps } from '../faceTypes';

const native = Platform.OS !== 'web';
const SKIN = '#E3AE88', SKIN_D = '#D39B76', GREY = '#BDC0C6', GREY_D = '#8E929A', GOLD = '#C6A36A', IVORY = '#F0F1F2', VEST = '#14161B';

function timing(v: Animated.Value, toValue: number, duration: number, useNativeDriver = native) {
  return Animated.timing(v, { toValue, duration, useNativeDriver });
}

const POSES = {
  idle: { tilt: 0, bl: 0, br: 0, brRot: 5, gx: 0, gy: 0 },
  listening: { tilt: 5, bl: -1.8, br: -1.8, brRot: 5, gx: 0, gy: 0 },
  thinking: { tilt: -3, bl: 0.4, br: -3.2, brRot: -3, gx: 1.5, gy: -1.3 },
  talking: { tilt: 0, bl: 0, br: 0, brRot: 5, gx: 0, gy: 0 },
} as const;

export function VestFace({ state, mouthOpen, size }: MartyFaceProps) {
  const u = size / 100;
  const box = (l: number, t: number, w: number, h: number, extra: ViewStyle = {}): ViewStyle =>
    ({ position: 'absolute', left: l * u, top: t * u, width: w * u, height: h * u, ...extra });

  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const bl = useRef(new Animated.Value(0)).current;
  const br = useRef(new Animated.Value(0)).current;
  const brRot = useRef(new Animated.Value(5)).current;
  const gx = useRef(new Animated.Value(0)).current;
  const gy = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const dots = useRef(new Animated.Value(0)).current;
  const mo = useRef(new Animated.Value(0)).current;

  // breathing, always on
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([timing(breathe, 1, 2200), timing(breathe, 0, 2200)]));
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  // blinks every ~3-5 s
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anim: Animated.CompositeAnimation | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        anim = Animated.sequence([timing(blink, 0.08, 70), timing(blink, 1, 120)]);
        anim.start(() => { if (alive) schedule(); });
      }, 3000 + Math.random() * 2000);
    };
    schedule();
    return () => { alive = false; if (timer) clearTimeout(timer); anim?.stop(); blink.setValue(1); };
  }, [blink]);

  // pose per state, plus halo and thinking dots loops
  useEffect(() => {
    const p = POSES[state];
    const to = Animated.parallel([
      timing(tilt, p.tilt, 350), timing(bl, p.bl, 300), timing(br, p.br, 300),
      timing(brRot, p.brRot, 300), timing(gx, p.gx, 300), timing(gy, p.gy, 300),
      timing(halo, state === 'listening' ? 1 : 0, 300),
    ]);
    to.start();
    let loop: Animated.CompositeAnimation | undefined;
    if (state === 'listening') {
      loop = Animated.loop(Animated.sequence([timing(halo, 0.6, 900), timing(halo, 1, 900)]));
      const t = setTimeout(() => loop?.start(), 320);
      return () => { clearTimeout(t); to.stop(); loop?.stop(); };
    }
    if (state === 'thinking') {
      dots.setValue(0);
      loop = Animated.loop(timing(dots, 1, 1500));
      loop.start();
    }
    return () => { to.stop(); loop?.stop(); };
  }, [state, tilt, bl, br, brRot, gx, gy, halo, dots]);

  // mouth follows the prop directly (light 50 ms smoothing)
  useEffect(() => {
    const target = state === 'talking' ? Math.max(0, Math.min(1, mouthOpen || 0)) : 0;
    const a = timing(mo, target, state === 'talking' ? 50 : 150, false);
    a.start();
    return () => a.stop();
  }, [mouthOpen, state, mo]);

  const talking = state === 'talking';
  const deg = (v: Animated.Value, r: number) => v.interpolate({ inputRange: [-r, r], outputRange: [`${-r}deg`, `${r}deg`] });
  const mouthH = mo.interpolate({ inputRange: [0, 1], outputRange: [1.5 * u, 10 * u] });
  const mouthW = mo.interpolate({ inputRange: [0, 1], outputRange: [10 * u, 13 * u] });
  const lift = mo.interpolate({ inputRange: [0, 1], outputRange: [0, -1.4 * u] });
  const eyePos = [35, 57];
  const dotStyle = (i: number) => {
    const p = 0.2 + i * 0.25;
    return {
      opacity: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }),
      transform: [{ translateY: dots.interpolate({ inputRange: [0, p - 0.2, p, p + 0.2, 1], outputRange: [0, 0, -1.2 * u, 0, 0] }) }],
    };
  };

  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }} accessibilityLabel={`Marty, ${state}`}>
      {/* listening halo */}
      <Animated.View pointerEvents="none" style={[box(2, 2, 96, 96, { borderRadius: 48 * u, borderWidth: Math.max(1, 1.6 * u), borderColor: GOLD, backgroundColor: 'rgba(198,163,106,0.12)' }),
        { opacity: halo, transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]} />

      {/* head + shoulders, breathing */}
      <Animated.View style={[box(0, 0, 100, 100), { transform: [
        { translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, 0.9 * u] }) },
        { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] }) }] }]}>
        {/* shoulders: white sleeves, shirt, black vest */}
        <View style={box(6, 70, 88, 60, { backgroundColor: IVORY, borderTopLeftRadius: 32 * u, borderTopRightRadius: 32 * u })} />
        <View style={box(12, 72, 31, 40, { backgroundColor: VEST, borderTopLeftRadius: 22 * u, borderTopRightRadius: 4 * u, transform: [{ rotate: '-4deg' }] })} />
        <View style={box(57, 72, 31, 40, { backgroundColor: VEST, borderTopRightRadius: 22 * u, borderTopLeftRadius: 4 * u, transform: [{ rotate: '4deg' }] })} />
        {/* vest gold edging and buttons */}
        <View style={box(40.5, 78, 0.9, 24, { backgroundColor: GOLD, opacity: 0.7, transform: [{ rotate: '-6deg' }] })} />
        <View style={box(58.6, 78, 0.9, 24, { backgroundColor: GOLD, opacity: 0.7, transform: [{ rotate: '6deg' }] })} />
        <View style={box(65, 90, 2.4, 2.4, { backgroundColor: GOLD, borderRadius: 2 * u })} />
        <View style={box(66, 96, 2.4, 2.4, { backgroundColor: GOLD, borderRadius: 2 * u })} />
        {/* neck + collar */}
        <View style={box(41, 62, 18, 14, { backgroundColor: SKIN_D, borderRadius: 4 * u })} />
        <View style={box(37.5, 69, 13, 9, { backgroundColor: '#FFFFFF', borderColor: '#C9CCD2', borderWidth: Math.max(0.5, 0.5 * u), borderTopLeftRadius: 2 * u, borderBottomLeftRadius: 5 * u, borderTopRightRadius: 5 * u, borderBottomRightRadius: 1 * u, transform: [{ rotate: '30deg' }] })} />
        <View style={box(49.5, 69, 13, 9, { backgroundColor: '#FFFFFF', borderColor: '#C9CCD2', borderWidth: Math.max(0.5, 0.5 * u), borderTopRightRadius: 2 * u, borderBottomRightRadius: 5 * u, borderTopLeftRadius: 5 * u, borderBottomLeftRadius: 1 * u, transform: [{ rotate: '-30deg' }] })} />
        {/* bar towel over his left shoulder (viewer's left) */}
        <View style={box(10, 66, 17, 34, { backgroundColor: '#E9E4D6', borderColor: '#B9B29E', borderWidth: Math.max(0.5, 0.6 * u), borderRadius: 3 * u, transform: [{ rotate: '9deg' }] })}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 6 * u, height: 1.8 * u, backgroundColor: '#3C5D8A' }} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 10 * u, height: 1.8 * u, backgroundColor: '#3C5D8A' }} />
        </View>

        {/* head group, tilts around the neck */}
        <Animated.View style={[box(0, 0, 100, 100), { transform: [{ translateY: 20 * u }, { rotate: deg(tilt, 10) }, { translateY: -20 * u }] }]}>
          {/* ears */}
          <View style={box(21.5, 41, 7, 11, { backgroundColor: SKIN_D, borderRadius: 4 * u })} />
          <View style={box(71.5, 41, 7, 11, { backgroundColor: SKIN_D, borderRadius: 4 * u })} />
          {/* head */}
          <View style={box(26, 12, 48, 62, { backgroundColor: SKIN, borderRadius: 24 * u, borderBottomLeftRadius: 22 * u, borderBottomRightRadius: 22 * u })} />
          <View style={box(37, 15, 16, 5, { backgroundColor: '#FFFFFF', opacity: 0.22, borderRadius: 4 * u, transform: [{ rotate: '-12deg' }] })} />
          <View style={box(38, 23, 24, 0.8, { backgroundColor: SKIN_D, opacity: 0.55, borderRadius: u })} />
          <View style={box(41, 26.5, 18, 0.8, { backgroundColor: SKIN_D, opacity: 0.4, borderRadius: u })} />
          {/* grey hair on the sides */}
          <View style={box(24.5, 33, 6.5, 19, { backgroundColor: GREY, borderTopLeftRadius: 5 * u, borderTopRightRadius: 3 * u, borderBottomLeftRadius: 4 * u, borderBottomRightRadius: 2 * u })} />
          <View style={box(69, 33, 6.5, 19, { backgroundColor: GREY, borderTopRightRadius: 5 * u, borderTopLeftRadius: 3 * u, borderBottomRightRadius: 4 * u, borderBottomLeftRadius: 2 * u })} />
          {/* cheeks and nose */}
          <View style={box(31, 49, 8, 5, { backgroundColor: '#E5826F', opacity: 0.28, borderRadius: 4 * u })} />
          <View style={box(61, 49, 8, 5, { backgroundColor: '#E5826F', opacity: 0.28, borderRadius: 4 * u })} />
          <View style={box(45, 44, 10, 10, { backgroundColor: '#DDA07A', borderRadius: 5 * u })} />
          {/* eyes */}
          {eyePos.map(x => (
            <Animated.View key={x} style={[box(x - 0.5, 39.5, 9, 6.4, { backgroundColor: '#F7F3EA', borderRadius: 3 * u, overflow: 'hidden', borderWidth: Math.max(0.5, 0.4 * u), borderColor: '#8A6A55' }), { transform: [{ scaleY: blink }] }]}>
              <Animated.View style={{ position: 'absolute', left: 2.8 * u, top: 1.4 * u, width: 3.6 * u, height: 3.6 * u, borderRadius: 2 * u, backgroundColor: '#3A2A22', transform: [{ translateX: gx.interpolate({ inputRange: [-2, 2], outputRange: [-2 * u, 2 * u] }) }, { translateY: gy.interpolate({ inputRange: [-2, 2], outputRange: [-2 * u, 2 * u] }) }] }} />
            </Animated.View>
          ))}
          {/* eyebrows */}
          <Animated.View style={[box(32.5, 33.5, 11.5, 3.2, { backgroundColor: GREY, borderRadius: 2 * u }), { transform: [{ translateY: bl.interpolate({ inputRange: [-4, 4], outputRange: [-4 * u, 4 * u] }) }, { rotate: '-6deg' }] }]} />
          <Animated.View style={[box(56, 33.5, 11.5, 3.2, { backgroundColor: GREY, borderRadius: 2 * u }), { transform: [{ translateY: br.interpolate({ inputRange: [-4, 4], outputRange: [-4 * u, 4 * u] }) }, { rotate: deg(brRot, 10) }] }]} />
          {/* mouth */}
          {talking ? (
            <View style={box(30, 63.5, 40, 12, { alignItems: 'center' })}>
              <Animated.View style={{ width: mouthW, height: mouthH, backgroundColor: '#3B1517', borderRadius: 4 * u, borderTopLeftRadius: 2 * u, borderTopRightRadius: 2 * u, overflow: 'hidden', alignItems: 'center' }}>
                <View style={{ position: 'absolute', top: 0, left: 1 * u, right: 1 * u, height: 3 * u, backgroundColor: '#F7F3EA', borderBottomLeftRadius: 1.2 * u, borderBottomRightRadius: 1.2 * u }} />
                <View style={{ position: 'absolute', bottom: -1.8 * u, width: 8 * u, height: 5 * u, borderRadius: 3 * u, backgroundColor: '#C8605F' }} />
              </Animated.View>
            </View>
          ) : (
            <View style={box(43, 62.5, 14, 6, { borderBottomWidth: Math.max(1, 1.5 * u), borderColor: '#8A3F38', borderBottomLeftRadius: 8 * u, borderBottomRightRadius: 8 * u })} />
          )}
          {/* mustache, lifts with the mouth */}
          <Animated.View style={[box(0, 0, 100, 100), { transform: [{ translateY: lift }] }]} pointerEvents="none">
            <View style={box(31.5, 54.5, 19.5, 9.5, { backgroundColor: GREY, borderTopLeftRadius: 6 * u, borderTopRightRadius: 6 * u, borderBottomLeftRadius: 7 * u, borderBottomRightRadius: 4 * u, transform: [{ rotate: '-7deg' }] })} />
            <View style={box(49, 54.5, 19.5, 9.5, { backgroundColor: GREY, borderTopRightRadius: 6 * u, borderTopLeftRadius: 6 * u, borderBottomRightRadius: 7 * u, borderBottomLeftRadius: 4 * u, transform: [{ rotate: '7deg' }] })} />
            <View style={box(43, 53.5, 14, 6, { backgroundColor: GREY, borderRadius: 3 * u })} />
            <View style={box(35, 56.5, 13, 1, { backgroundColor: GREY_D, opacity: 0.5, borderRadius: u, transform: [{ rotate: '-7deg' }] })} />
            <View style={box(52, 56.5, 13, 1, { backgroundColor: GREY_D, opacity: 0.5, borderRadius: u, transform: [{ rotate: '7deg' }] })} />
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* thinking dots, above right of the head */}
      {state === 'thinking' && [0, 1, 2].map(i => (
        <Animated.View key={i} style={[box(77 + i * 6, 12 - i * 2.5, 3.6 + i * 0.8, 3.6 + i * 0.8, { borderRadius: 3 * u, backgroundColor: GOLD }), dotStyle(i)]} />
      ))}
    </View>
  );
}
