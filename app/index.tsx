import { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useScan } from '../src/state/ScanContext';
import LiveScanner from '../src/live/LiveScanner';

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
  const [scanPhotos, setScanPhotos] = useState<string[] | null>(null);
  const [scanSource, setScanSource] = useState<'camera'|'gallery'>('camera');
  const [scanMode, setScanMode] = useState<'smart'|'menu'>('smart');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      if (photo?.uri) {
        if (scanMode === 'menu') { addPages([photo.uri], 'camera'); router.push('/preview'); }
        else { setScanSource('camera'); setScanPhotos([photo.uri]); }
      } else setCameraMessage('The camera did not return an image. Try again.');
    } catch { setCameraMessage('Could not capture this image. Please try again.'); }
    finally { setCapturing(false); }
  };

  const openGallery = async () => {
    try {
      const limit = scanMode === 'menu' ? 12 : 6;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: limit, quality: 0.85 });
      if (result.canceled || !result.assets.length) return;
      const uris = result.assets.slice(0, limit).map(a => a.uri);
      if (scanMode === 'menu') { addPages(uris, 'gallery'); router.push('/preview'); }
      else { setScanSource('gallery'); setScanPhotos(uris); }
    } catch { setCameraMessage('Could not open your photo library. Please try again.'); }
  };

  if (scanPhotos) return <LiveScanner photos={scanPhotos} source={scanSource} onClose={() => setScanPhotos(null)} />;
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
        <View><Text style={s.wordmark}>HARMONY</Text><Text style={s.wordmarkSub}>D I S C O V E R</Text></View>
        <View style={s.topActions}><View style={s.livePill}><View style={s.liveDot}/><Text style={s.liveText}>VIEWFINDER</Text></View><Pressable style={s.profileButton} onPress={() => router.push('/collection')}><Ionicons name="person-outline" size={19} color={C.ivory} /></Pressable></View>
      </View>
      <View style={[s.modeSwitch, { top: Math.max(insets.top, 24) + 76 }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: scanMode === 'smart' }} onPress={() => setScanMode('smart')} style={[s.modeOption, scanMode === 'smart' && s.modeOptionActive]}>
          <Ionicons name="scan-outline" size={13} color={scanMode === 'smart' ? '#111' : C.ivory} />
          <Text style={[s.modeLabel, scanMode === 'smart' && s.modeLabelActive]}>SMART SCAN</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: scanMode === 'menu' }} onPress={() => setScanMode('menu')} style={[s.modeOption, scanMode === 'menu' && s.modeOptionActive]}>
          <Ionicons name="book-outline" size={13} color={scanMode === 'menu' ? '#111' : C.ivory} />
          <Text style={[s.modeLabel, scanMode === 'menu' && s.modeLabelActive]}>MENU PAGES</Text>
        </Pressable>
      </View>
      <View style={[s.centerHint, { top: Math.max(insets.top, 24) + 132, bottom: Math.max(insets.bottom, 12) + (screenHeight < 750 ? 218 : 238) }]} pointerEvents="none">
        <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} /><View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
        <Text style={s.centerHintText}>{scanMode === 'menu' ? 'CAPTURE EVERY MENU PAGE · UP TO 12' : 'BOTTLES, MENUS & BEVERAGE LABELS'}</Text>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" style={s.utilityControl} onPress={() => setSettingsOpen(v => !v)}><Ionicons name="settings-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>SETTINGS</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Marty" style={s.utilityControl} onPress={() => router.push('/bartender')}><Ionicons name="chatbubble-ellipses-outline" size={compactDock ? 15 : 17} color={C.brass} /><Text style={[s.utilityLabel, { color: C.brass }]}>MARTY</Text></Pressable>
        </View>
      </View>
      {settingsOpen && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Close settings" onPress={()=>setSettingsOpen(false)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:20,backgroundColor:'rgba(0,0,0,0.42)'}} />
        <View style={{position:'absolute',zIndex:21,left:12,right:12,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,padding:14,borderRadius:18,backgroundColor:'rgba(10,13,18,0.98)',borderWidth:1,borderColor:'rgba(198,163,106,0.48)'}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <Text style={{color:C.ivory,fontSize:12,fontWeight:'900',letterSpacing:1.5}}>DISCOVER SETTINGS</Text>
            <Pressable onPress={()=>setSettingsOpen(false)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable>
          </View>
          <Pressable style={s.menuRow} onPress={()=>setCameraMessage('Screen orientation is automatic. Rotate your device to change the layout.')}><Ionicons name="phone-portrait-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Screen orientation</Text><Text style={s.menuDesc}>Automatic · portrait and landscape</Text></View><Text style={s.menuValue}>AUTO</Text></Pressable>
          <Pressable style={s.menuRow} onPress={async()=>{const p=permission?.granted?permission:await requestPermission();setCameraMessage(p.granted?'Camera access is enabled.':'Camera access was not granted. Check iOS Settings.');}}><Ionicons name="camera-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Camera access</Text><Text style={s.menuDesc}>Manage camera permission</Text></View><Text style={s.menuValue}>{permission.granted?'ON':'CHECK'}</Text></Pressable>
          <Pressable style={s.menuRow} onPress={()=>setCameraMessage('Photos are processed only after you select or capture them.')}><Ionicons name="images-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Photo processing</Text><Text style={s.menuDesc}>Review selected photos before processing</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);router.push('/contributions');}}><Ionicons name="shield-checkmark-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Measure & contribution permissions</Text><Text style={s.menuDesc}>Optional research and measurement sharing</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <View style={{height:1,backgroundColor:C.line,marginVertical:8}}/>
          <Text style={{color:C.brass,fontSize:9,fontWeight:'900',letterSpacing:1.4,marginBottom:4}}>ADVANCED SCANNERS</Text>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);router.push('/live-inventory');}}><Ionicons name="scan-outline" size={18} color="#7DFFB5"/><View style={{flex:1}}><Text style={s.menuTitle}>Live Inventory Scanner</Text><Text style={s.menuDesc}>Live visual regions and bottle inventory workflow</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);router.push('/arkit-live-test');}}><Ionicons name="cube-outline" size={18} color="#4F8BFF"/><View style={{flex:1}}><Text style={s.menuTitle}>Live 3D / LiDAR Scanner</Text><Text style={s.menuDesc}>ARKit depth and world-tracking test · capability dependent</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
        </View>
      </>}
    </View>
  );
}
const s = StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},menuRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:11,paddingVertical:7,borderBottomWidth:1,borderBottomColor:'rgba(153,163,174,0.12)'},menuTitle:{color:C.ivory,fontSize:11,fontWeight:'800'},menuDesc:{color:C.muted,fontSize:9,marginTop:3},menuValue:{color:C.brass,fontSize:8,fontWeight:'900',letterSpacing:1},modeSwitch:{position:'absolute',zIndex:5,left:26,right:26,alignSelf:'center',maxWidth:330,flexDirection:'row',gap:5,padding:4,borderRadius:24,backgroundColor:'rgba(8,10,13,0.84)',borderWidth:1,borderColor:C.line},modeOption:{flex:1,minHeight:36,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,borderRadius:20,paddingHorizontal:8},modeOptionActive:{backgroundColor:C.brass},modeLabel:{color:C.ivory,fontSize:9,fontWeight:'900',letterSpacing:1},modeLabelActive:{color:'#111'},cameraMessage:{position:'absolute',left:24,right:24,zIndex:20,padding:11,borderRadius:10,backgroundColor:'rgba(8,10,13,0.94)',borderWidth:1,borderColor:C.line},cameraMessageText:{color:C.ivory,fontSize:11,lineHeight:16,textAlign:'center'},loading:{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},loadingText:{color:C.brass,letterSpacing:5,fontWeight:'800'},
 permissionFallback:{backgroundColor:'#090B0F',alignItems:'center',justifyContent:'center'},permissionCard:{position:'absolute',left:28,right:28,top:'35%',padding:22,borderRadius:18,backgroundColor:'rgba(9,11,14,0.92)',borderWidth:1,borderColor:C.line},permissionTitle:{color:C.ivory,fontSize:23,fontWeight:'700',marginTop:12},permissionBody:{color:C.muted,fontSize:13,lineHeight:20,marginTop:7},permissionButton:{backgroundColor:C.brass,padding:14,borderRadius:10,alignItems:'center',marginTop:18},permissionButtonText:{color:'#111',fontSize:11,fontWeight:'900',letterSpacing:1.5},
 viewfinderShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(3,5,8,0.25)'},topBar:{position:'absolute',top:Platform.OS==='ios'?62:34,left:22,right:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},wordmark:{color:C.ivory,fontSize:17,fontWeight:'900',letterSpacing:4},wordmarkSub:{color:C.brass,fontSize:8,fontWeight:'700',letterSpacing:2.5,marginTop:4},topActions:{flexDirection:'row',alignItems:'center',gap:9},livePill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:9,paddingVertical:7,borderRadius:14,backgroundColor:'rgba(8,10,13,0.7)',borderWidth:1,borderColor:'rgba(153,163,174,0.18)'},liveDot:{width:5,height:5,borderRadius:3,backgroundColor:'#B75D55'},liveText:{color:C.ivory,fontSize:9,fontWeight:'800',letterSpacing:1},profileButton:{width:34,height:34,borderRadius:17,backgroundColor:'rgba(8,10,13,0.7)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},
 centerHint:{position:'absolute',left:26,right:26,justifyContent:'center',alignItems:'center'},centerHintText:{color:'rgba(240,241,242,0.68)',fontSize:9,letterSpacing:2.4,fontWeight:'700'},corner:{position:'absolute',width:25,height:25,borderColor:'rgba(198,163,106,0.8)'},tl:{top:0,left:0,borderTopWidth:1,borderLeftWidth:1},tr:{top:0,right:0,borderTopWidth:1,borderRightWidth:1},bl:{bottom:0,left:0,borderBottomWidth:1,borderLeftWidth:1},br:{bottom:0,right:0,borderBottomWidth:1,borderRightWidth:1},
 bottomArea:{position:'absolute',bottom:0,backgroundColor:'rgba(7,9,12,0.92)',borderTopWidth:1,borderColor:C.line,borderTopLeftRadius:20,borderTopRightRadius:20,paddingHorizontal:8},controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4},utilityControl:{alignItems:'center',justifyContent:'center',gap:5,minWidth:42,paddingVertical:7},utilityLabel:{color:C.ivory,fontSize:7,fontWeight:'800',letterSpacing:0.7},centerControls:{flexDirection:'row',alignItems:'center',gap:8},primaryControl:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(20,24,30,0.9)'},primaryControlHalf:{width:30,height:30},primaryControlActive:{borderColor:C.brass},shutterOuter:{width:66,height:66,borderRadius:33,borderWidth:2,borderColor:C.ivory,alignItems:'center',justifyContent:'center'},shutterOuterCompact:{width:58,height:58},shutterInner:{width:52,height:52,borderRadius:26,backgroundColor:C.ivory},shutterInnerCompact:{width:44,height:44},shutterBusy:{opacity:0.55},shutterBusyText:{color:'#111',textAlign:'center',fontSize:20,fontWeight:'900',lineHeight:50}
});
