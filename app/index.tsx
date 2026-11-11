import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useScan } from '../src/state/ScanContext';

const C = { bg: '#07090C', panel: 'rgba(10,12,16,0.96)', line: 'rgba(153,163,174,0.22)', brass: '#C6A36A', ivory: '#F0F1F2', muted: '#858C95', red: '#A84343', signal: '#C05A50' };

export default function Home() {
  const camera = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;
  const compactDock = screenWidth < 390 || (isLandscape && screenHeight < 500);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('');
  const { addPages } = useScan();

  const capture = async () => {
    if (capturing) return;
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) setCameraMessage('Camera access is needed to capture a menu.');
      return;
    }
    try {
      setCapturing(true);
      setCameraMessage('');
      const photo = await camera.current?.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) { addPages([photo.uri], 'camera'); router.push('/preview'); }
      else setCameraMessage('The camera did not return an image. Try again.');
    } catch {
      setCameraMessage('Could not capture this image. Please try again.');
    } finally { setCapturing(false); }
  };

  const openGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.85 });
      if (!result.canceled && result.assets.length) { addPages(result.assets.map(a => a.uri), 'gallery'); router.push('/preview'); }
    } catch { setCameraMessage('Could not open your photo library. Please try again.'); }
  };

  if (!permission) return <View style={s.loading}><Text style={s.loadingText}>DISCOVER</Text></View>;

  return (
    <View style={s.root}>
      {permission.granted ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" flash={flashEnabled ? "on" : "off"} />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.permissionFallback]}>
          <View style={s.permissionCard}>
            <Ionicons name="camera-outline" size={28} color={C.brass} />
            <Text style={s.permissionTitle}>Your menu is out there.</Text>
            <Text style={s.permissionBody}>Enable the camera to make the viewfinder your home screen.</Text>
            <Pressable style={s.permissionButton} onPress={requestPermission}><Text style={s.permissionButtonText}>ENABLE CAMERA</Text></Pressable>
          </View>
        </View>
      )}

      <View pointerEvents="none" style={s.viewfinderShade} />
      {!!cameraMessage && <View style={[s.cameraMessage, { top: Math.max(insets.top, 24) + 75 }]}><Text style={s.cameraMessageText}>{cameraMessage}</Text></View>}
      <View style={[s.topBar, { top: Math.max(insets.top, Platform.OS === 'ios' ? 12 : 8) + 10 }]}>
        <View>
          <Text style={s.wordmark}>HARMONY</Text>
          <Text style={s.wordmarkSub}>D I S C O V E R</Text>
        </View>
        <View style={s.topActions}><View style={s.livePill}><View style={s.liveDot}/><Text style={s.liveText}>VIEWFINDER</Text></View><Pressable style={s.profileButton} onPress={() => router.push('/collection')}><Ionicons name="person-outline" size={19} color={C.ivory} /></Pressable></View>
      </View>

      <View style={[s.centerHint, { top: Math.max(insets.top, 24) + 112, bottom: Math.max(insets.bottom, 12) + (screenHeight < 750 ? 218 : 238) }]} pointerEvents="none">
        <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} /><View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
        <Text style={s.centerHintText}>FIND THE DRINK WORTH TALKING ABOUT</Text>
      </View>



      <View style={[s.bottomArea, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 6) + (isLandscape ? 5 : 7), paddingTop: isLandscape ? 6 : 8, left: isLandscape ? 22 : 10, right: isLandscape ? 22 : 10 }]}>
        <View style={s.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Favorites" style={s.utilityControl} onPress={() => router.push('/collection')}><Ionicons name="heart-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>FAVORITES</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Nearby discoveries" style={s.utilityControl} onPress={() => router.push('/nearby')}><Ionicons name="compass-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>NEARBY</Text></Pressable>
          <View style={s.centerControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose photos from gallery" style={[s.primaryControl, s.primaryControlHalf]} onPress={openGallery}><Ionicons name="images-outline" size={compactDock ? 11 : 12} color={C.ivory} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={capturing ? 'Capturing menu' : 'Capture menu'} disabled={capturing} style={[s.shutterOuter, compactDock && s.shutterOuterCompact, capturing && s.shutterBusy]} onPress={capture}><View style={[s.shutterInner, compactDock && s.shutterInnerCompact]}>{capturing && <Text style={s.shutterBusyText}>…</Text>}</View></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={flashEnabled ? 'Turn flash off' : 'Turn flash on'} style={[s.primaryControl, s.primaryControlHalf, flashEnabled && s.primaryControlActive]} onPress={() => setFlashEnabled(v => !v)}><Ionicons name="flash" size={compactDock ? 11 : 12} color={flashEnabled ? C.brass : C.ivory} /></Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" style={s.utilityControl} onPress={() => router.push('/settings')}><Ionicons name="settings-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>SETTINGS</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Marty" style={s.utilityControl} onPress={() => router.push('/bartender')}><Ionicons name="chatbubble-ellipses-outline" size={compactDock ? 15 : 17} color={C.brass} /><Text style={[s.utilityLabel, { color: C.brass }]}>MARTY</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, cameraMessage: { position: 'absolute', left: 24, right: 24, zIndex: 20, padding: 11, borderRadius: 10, backgroundColor: 'rgba(8,10,13,0.94)', borderWidth: 1, borderColor: C.line }, cameraMessageText: { color: C.ivory, fontSize: 11, lineHeight: 16, textAlign: 'center' }, loading: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: C.brass, letterSpacing: 5, fontWeight: '800' },
  permissionFallback: { backgroundColor: '#090B0F', alignItems: 'center', justifyContent: 'center' }, permissionShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,5,7,0.68)' }, permissionCard: { position: 'absolute', left: 28, right: 28, top: '35%', padding: 22, borderRadius: 18, backgroundColor: 'rgba(9,11,14,0.92)', borderWidth: 1, borderColor: C.line }, permissionTitle: { color: C.ivory, fontSize: 23, fontWeight: '700', marginTop: 12 }, permissionBody: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 7 }, permissionButton: { backgroundColor: C.brass, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 18 }, permissionButtonText: { color: '#111', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  viewfinderShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,5,8,0.25)' }, topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 62 : 34, left: 22, right: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, wordmark: { color: C.ivory, fontSize: 17, fontWeight: '900', letterSpacing: 4 }, wordmarkSub: { color: C.brass, fontSize: 8, fontWeight: '700', letterSpacing: 2.5, marginTop: 4 }, topActions: { flexDirection: 'row', alignItems: 'center', gap: 9 }, livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(8,10,13,0.7)', borderWidth: 1, borderColor: 'rgba(153,163,174,0.18)' }, liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9C756F' }, liveText: { color: '#AAB0B7', fontSize: 7, letterSpacing: 1.3, fontWeight: '800' }, profileButton: { width: 39, height: 39, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: 'rgba(8,10,13,0.65)', alignItems: 'center', justifyContent: 'center' },
  centerHint: { position: 'absolute', top: '22%', bottom: '39%', left: 30, right: 30, alignItems: 'center', justifyContent: 'center' }, centerHintText: { color: 'rgba(241,238,231,0.45)', fontSize: 8, letterSpacing: 2.4, fontWeight: '700' }, corner: { position: 'absolute', width: 22, height: 22, borderColor: 'rgba(196,163,106,0.5)' }, tl: { top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1 }, tr: { top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1 }, bl: { bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1 }, br: { bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1 },
  bartenderDock: { position: 'absolute', left: 14, right: 14, bottom: 153, minHeight: 92, flexDirection: 'row', alignItems: 'center', padding: 11, borderRadius: 17, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 }, bartenderDockExpanded: { minHeight: 125, alignItems: 'flex-start' }, portraitWrap: { width: 55, height: 62, marginRight: 11 }, portrait: { width: 55, height: 62, overflow: 'hidden', backgroundColor: '#27231E' }, portraitTint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(22,15,9,0.25)' }, voiceOfflineDot: { position: 'absolute', right: -2, bottom: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#9A7773', borderWidth: 2, borderColor: '#111418' }, bartenderCopy: { flex: 1, minWidth: 0 }, bartenderTopline: { flexDirection: 'row', alignItems: 'center', gap: 7 }, bartenderName: { color: C.brass, fontSize: 8, letterSpacing: 1.7, fontWeight: '900' }, bartenderStatus: { color: '#9A7773', fontSize: 7, letterSpacing: 1, fontWeight: '700' }, bartenderLine: { color: C.ivory, fontSize: 12, lineHeight: 17, marginTop: 6 }, bartenderSubline: { color: C.muted, fontSize: 9, lineHeight: 13, marginTop: 5, maxWidth: 220 }, voiceStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 }, voiceStatusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9A7773' }, voiceStatusText: { color: '#9A7773', fontSize: 7, letterSpacing: 1.1, fontWeight: '800' }, detailsButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#171A1F', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginLeft: 7 }, dismissButton: { position: 'absolute', top: 5, right: 6, padding: 3 }, bartenderRestore: { position: 'absolute', bottom: 157, right: 18, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line }, restoreText: { color: C.ivory, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }, restoreHint: { color: C.muted, fontSize: 7, letterSpacing: 0.6 }, voiceOfflineDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9A7773' },
  bottomArea: { position: 'absolute', left: 10, right: 10, bottom: 0, paddingHorizontal: 9, paddingTop: 8, paddingBottom: 8, borderRadius: 25, borderWidth: 1, borderColor: 'rgba(196,163,106,0.78)', backgroundColor: 'rgba(6,8,11,0.94)', shadowColor: '#D5A34F', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 12 }, controls: { width: '100%', height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2 }, centerControls: { height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, flexShrink: 0 }, utilityControl: { width: 42, flexShrink: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 3 }, utilityLabel: { color: '#D5D1C8', fontSize: 6.5, fontWeight: '800', letterSpacing: 0.25 }, activeLabel: { color: C.brass }, primaryControl: { width: 48, height: 48, flexShrink: 0, borderRadius: 24, borderWidth: 1.4, borderColor: 'rgba(196,163,106,0.85)', backgroundColor: 'rgba(22,22,22,0.95)', alignItems: 'center', justifyContent: 'center', shadowColor: '#D5A34F', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }, primaryControlActive: { backgroundColor: 'rgba(196,163,106,0.18)' }, primaryControlCompact: { width: 42, height: 42, borderRadius: 21 }, primaryControlHalf: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 }, shutterOuter: { width: 64, height: 64, flexShrink: 0, borderRadius: 32, borderWidth: 2, borderColor: '#E3B967', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,14,14,0.98)', shadowColor: '#E3B967', shadowOpacity: 0.42, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }, shutterOuterCompact: { width: 54, height: 54, borderRadius: 27 }, shutterInner: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5EBDD', borderWidth: 3, borderColor: '#B9A178', alignItems: 'center', justifyContent: 'center' }, shutterInnerCompact: { width: 40, height: 40, borderRadius: 20 }, shutterBusy: { opacity: 0.6 }, shutterBusyText: { color: '#17191D', fontSize: 20, fontWeight: '900' }
});
