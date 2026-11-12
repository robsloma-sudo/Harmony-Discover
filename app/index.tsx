import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useScan } from '../src/state/ScanContext';
import LiveScanner from '../src/live/LiveScanner';
import { DiscoverARSurface, type ARTrackingUpdate, type NativeSpatialAnchor } from '../src/live/DiscoverARSurface';
import type { ARKitDepthFrame } from '../src/live/DiscoverARSurface';
import type { BottleRead, MenuGlimpse } from '../src/services/discoverLiveApi';
import { shouldEnableLiveRecognition } from '../src/live/recognitionPolicy';
import PrivacyPanel from '../src/home-panels/PrivacyPanel';
import NearbyPanel from '../src/home-panels/NearbyPanel';
import JourneyPlayerOverlay, { type JourneyScanItem } from '../src/home-panels/JourneyPlayerOverlay';
import { MartyPanel } from '../src/home-panels/MartyPanel';
import { MartyConsentPanel } from '../src/home-panels/MartyConsentPanel';
import LidarScannerPanel from '../src/home-panels/LidarScannerPanel';
import { associateLabelSignalsToBottles } from '../src/live/labelBottleAssociation';
import { SpatialBottleTracker } from '../src/live/spatialBottleTracker';
import { projectBottleBoxToWorld } from '../src/live/spatialBottleProjection';
import { mergeTrackedBottleCandidates, type TrackedBottleRecord } from '../src/live/trackedBottleRegistry';
import { LiveInventoryPanel } from './live-inventory';
import { PreviewPanel } from './preview';

const C = { bg: '#07090C', panel: 'rgba(10,12,16,0.96)', line: 'rgba(153,163,174,0.22)', brass: '#C6A36A', ivory: '#F0F1F2', muted: '#858C95', red: '#A84343', signal: '#C05A50' };

export default function Home({ initialPanel }: { initialPanel?: 'favorites'|'nearby'|'marty'|'privacy'|'inventory'|'lidar'|'menu'|'settings'|'collection'|'taste' } = {}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { addPages, appendPages, pages } = useScan();
  const isLandscape = screenWidth > screenHeight;
  const compactDock = screenWidth < 390 || (isLandscape && screenHeight < 500);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [captureRequestId, setCaptureRequestId] = useState(0);
  const pendingCapture = useRef<'scan'|'menu_page'|null>(null);
  const [liveTracking, setLiveTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'camera_starting' });
  const [liveDepthStatus, setLiveDepthStatus] = useState('waiting_for_depth_provider');
  const [liveDepthFrame, setLiveDepthFrame] = useState<ARKitDepthFrame | null>(null);
  const depthFramesRef = useRef<ARKitDepthFrame[]>([]);
  const [liveBottleDepthFrame, setLiveBottleDepthFrame] = useState<ARKitDepthFrame | null>(null);
  const [liveBottleFrameTimestamp, setLiveBottleFrameTimestamp] = useState<number | null>(null);
  const [liveSpatialAnchors, setLiveSpatialAnchors] = useState<NativeSpatialAnchor[]>([]);
  const physicalBottleTrackerRef = useRef(new SpatialBottleTracker({ confirmationHits: 2, occlusionGraceMs: 2500, lostRetentionMs: 12000, minimumConfidence: 0.65 }));
  const processedBottleFrameTimestampRef = useRef(Number.NEGATIVE_INFINITY);
  const [livePhysicalIds, setLivePhysicalIds] = useState<string[]>([]);
  const [liveCandidates, setLiveCandidates] = useState<Array<{trackId:number;x:number;y:number;width:number;height:number;confidence:number;bottle?:BottleRead}>>([]);
  const [liveTrackedBottles, setLiveTrackedBottles] = useState<TrackedBottleRecord<BottleRead>[]>([]);
  const [liveBottleTracks, setLiveBottleTracks] = useState<TrackedBottleRecord<BottleRead>[]>([]);
  const [liveBottles, setLiveBottles] = useState<BottleRead[]>([]);
  const [liveBarcodes, setLiveBarcodes] = useState<Array<{value:string;symbology:string}>>([]);
  const [liveLabelText, setLiveLabelText] = useState<string[]>([]);
  const [liveTextItems, setLiveTextItems] = useState<Array<{text:string;confidence:number;box:{x0:number;y0:number;x1:number;y1:number}}>>([]);
  const [liveBarcodeItems, setLiveBarcodeItems] = useState<Array<{value:string;symbology:string;box:{x0:number;y0:number;x1:number;y1:number}}>>([]);
  const [liveMenu, setLiveMenu] = useState<MenuGlimpse | null>(null);
  const [liveReadAt, setLiveReadAt] = useState<number | null>(null);
  const [cameraMessage, setCameraMessage] = useState('');
  useEffect(() => {
    if (!liveReadAt) return;
    const staleTimer = setTimeout(() => {
      setLiveBottles([]);
      setLiveBarcodes([]);
      setLiveLabelText([]);
      setLiveTextItems([]);
      setLiveBarcodeItems([]);
      setLivePhysicalIds([]);
      setLiveSpatialAnchors([]);
      setLiveBottleDepthFrame(null);
      setLiveBottleFrameTimestamp(null);
      depthFramesRef.current = [];
      physicalBottleTrackerRef.current.reset();
      processedBottleFrameTimestampRef.current = Number.NEGATIVE_INFINITY;
    }, 6000);
    return () => clearTimeout(staleTimer);
  }, [liveReadAt]);
  useEffect(() => {
    if (liveTracking.state === 'limited') {
      // Brief ARKit tracking limitations should occlude, not destroy, physical IDs.
      setLiveSpatialAnchors(previous => previous.map(anchor => ({ ...anchor, state: 'occluded' })));
      return;
    }
    if (liveTracking.state === 'paused' || liveTracking.state === 'interrupted' || liveTracking.state === 'not_available') {
      physicalBottleTrackerRef.current.reset();
      processedBottleFrameTimestampRef.current = Number.NEGATIVE_INFINITY;
      setLiveSpatialAnchors([]);
      setLivePhysicalIds([]);
      setLiveBottles([]);
      setLiveCandidates([]);
      setLiveBottleTracks([]);
      setLiveBarcodes([]);
      setLiveLabelText([]);
      setLiveTextItems([]);
      setLiveBarcodeItems([]);
      setLiveDepthFrame(null);
      setLiveDepthStatus('waiting_for_depth_provider');
      setLiveBottleDepthFrame(null);
      setLiveBottleFrameTimestamp(null);
      depthFramesRef.current = [];
      return;
    }
    if (liveBottleFrameTimestamp === null) return;
    if (Platform.OS !== 'ios') {
      setLivePhysicalIds(liveBottles.map(() => ''));
      setLiveSpatialAnchors([]);
      return;
    }
    // Only update physical identities once per cloud-recognition frame. Never
    // re-count the same bottle boxes against later depth frames.
    if (!liveBottleDepthFrame || liveBottleDepthFrame.unit !== 'meters') {
      // A matching depth event may still be arriving. Do not consume this
      // recognition timestamp until its depth frame is available.
      setLivePhysicalIds(liveBottles.map(() => ''));
      setLiveSpatialAnchors(previous => previous.map(anchor => ({ ...anchor, state: 'occluded' })));
      return;
    }
    const frameTimestampMs = liveBottleFrameTimestamp * 1000;
    if (frameTimestampMs <= processedBottleFrameTimestampRef.current) return;
    processedBottleFrameTimestampRef.current = frameTimestampMs;
    const observations = liveBottles.map(bottle => {
      const projection = projectBottleBoxToWorld(liveBottleDepthFrame, {
        x: bottle.box.x0,
        y: bottle.box.y0,
        width: bottle.box.x1 - bottle.box.x0,
        height: bottle.box.y1 - bottle.box.y0,
      });
      const located = projection.status === 'located';
      const visualKey = [bottle.category, bottle.match?.brand || bottle.brand || '', bottle.product || ''].filter(Boolean).join(':').trim().toLowerCase() || undefined;
      return {
        worldPoint: located ? projection.worldPoint : undefined,
        confidence: bottle.confidence,
        geometryComplete: located,
        visualKey,
        reason: located ? undefined : projection.reason === 'insufficient_depth'
          ? 'insufficient_depth' as const
          : projection.reason === 'low_depth_confidence' ? 'low_confidence' as const : 'incomplete_geometry' as const,
      };
    });
    const updated = physicalBottleTrackerRef.current.update(observations, frameTimestampMs);
    setLivePhysicalIds(updated.observed.map(track => track?.physicalObjectId || ''));
    setLiveSpatialAnchors(updated.tracks.flatMap(track => track.worldPoint && track.state !== 'lost'
      ? [{ physicalObjectId: track.physicalObjectId, x: track.worldPoint.x, y: track.worldPoint.y, z: track.worldPoint.z, state: track.state }]
      : []));
  }, [liveBottleFrameTimestamp, liveBottleDepthFrame, liveBottles, liveTracking.state]);

  const [scanPhotos, setScanPhotos] = useState<string[] | null>(null);
  const [scanSource, setScanSource] = useState<'camera'|'gallery'>('camera');
  const [scanMode, setScanMode] = useState<'bottle'|'menu'|'auto'>('auto');
  const [journeyItems, setJourneyItems] = useState<JourneyScanItem[]>([]);
  const [activeJourney, setActiveJourney] = useState<JourneyScanItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialPanel === 'settings');
  const [martyConsentOpen, setMartyConsentOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<'favorites'|'nearby'|'marty'|'privacy'|'inventory'|'lidar'|'menu'|'collection'|'taste'|null>(initialPanel && initialPanel !== 'settings' ? initialPanel : null);
  const [nearbyCommand,setNearbyCommand] = useState<{id:number;action:'set_radius'|'set_category'|'search'|'recenter'|'configure';radius_miles?:number;category?:string;search?:string}|null>(null);
  const nearbyCommandId = useRef(0);
  const nearbyCommandResolvers = useRef(new Map<number,(result:string)=>void>());
  const dispatchNearbyCommand = (command:{action:'set_radius'|'set_category'|'search'|'recenter'|'configure';radius_miles?:number;category?:string;search?:string}) => new Promise<string>(resolve => { const id=++nearbyCommandId.current; nearbyCommandResolvers.current.set(id,resolve); setActivePanel('nearby'); setSettingsOpen(false); setNearbyCommand({...command,id}); });
  const handleNearbyCommandResult = (id:number,result:string) => { const resolve=nearbyCommandResolvers.current.get(id); if(resolve){nearbyCommandResolvers.current.delete(id);resolve(result);} };
  const handleMartyAppCommand = async (name:string,args:Record<string,unknown>):Promise<string> => {
    if(name==='navigate_discover'){
      const screen=String(args.screen||'');
      if(screen==='discover'){setActivePanel(null);setSettingsOpen(false);return 'Back on the camera viewfinder.';}
      if(screen==='nearby'){
        const hasFilters=args.radius_miles!==undefined||args.category!==undefined||args.search!==undefined;
        if(hasFilters)return dispatchNearbyCommand({action:'configure',radius_miles:typeof args.radius_miles==='number'?args.radius_miles:undefined,category:typeof args.category==='string'?args.category:undefined,search:typeof args.search==='string'?args.search:undefined});
        setSettingsOpen(false);setActivePanel('nearby');return 'Nearby Atlas is open on the camera screen.';
      }
      if(screen==='library'){setSettingsOpen(false);setActivePanel('favorites');return 'Favorites are open on the camera screen.';}
      if(screen==='taste'){setSettingsOpen(false);setActivePanel('taste');return 'My Taste is open on the camera screen.';}
      if(screen==='settings'){setActivePanel(null);setSettingsOpen(true);return 'Discover Settings are open.';}
      return 'That screen is not available.';
    }
    if(name==='control_nearby_atlas'){
      const action=String(args.action||'');
      if(action==='set_radius'&&typeof args.radius_miles==='number'&&[1,5,10,25].includes(args.radius_miles))return dispatchNearbyCommand({action:'set_radius',radius_miles:args.radius_miles});
      if(action==='set_category'&&typeof args.category==='string'&&['all','bar','cocktail_bar','restaurant','brewery','winery','distillery'].includes(args.category))return dispatchNearbyCommand({action:'set_category',category:args.category});
      if(action==='search'&&typeof args.search==='string'&&args.search.trim())return dispatchNearbyCommand({action:'search',search:args.search});
      if(action==='recenter')return dispatchNearbyCommand({action:'recenter'});
      return 'I need a valid radius, category, or search phrase to do that.';
    }
    return 'That action is not supported.';
  };

  // Scanner menu items select a mode only. The center shutter is the sole capture trigger.
  const startMenuScan = () => {
    setScanMode('menu');
    setScanSource('camera');
    setCameraMessage('MENU SCAN SELECTED · Press the center capture button to scan.');
    setSettingsOpen(false);
  };

  const startBottleScan = () => {
    setScanMode('bottle');
    setScanSource('camera');
    setCameraMessage('BOTTLE SCAN SELECTED · Press the center capture button to scan.');
    setSettingsOpen(false);
  };

  const addMenuPages = async () => {
    const remaining = Math.max(0, 12 - pages.length);
    if (!remaining) { setCameraMessage('This menu scan has reached the 12-page limit.'); return; }
    pendingCapture.current = 'menu_page';
    setCaptureRequestId(value => value + 1);
  };

  const handleCapturedImage = (event: { nativeEvent: { uri: string; width: number; height: number; timestamp: number } }) => {
    const uri = event.nativeEvent.uri;
    const kind = pendingCapture.current;
    pendingCapture.current = null;
    setCapturing(false);
    if (!uri || !kind) return;
    if (kind === 'menu_page') {
      appendPages([uri], 'camera');
      setCameraMessage('MENU PAGE CAPTURED');
      return;
    }
    if (scanMode === 'menu') addPages([uri], 'camera');
    setScanSource('camera');
    setScanPhotos([uri]);
  };

  const capture = async () => {
    if (capturing) return;
    setSettingsOpen(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) setCameraMessage('Camera access is needed to capture.');
      return;
    }
    setCapturing(true);
    setJourneyItems([]);
    setActiveJourney(null);
    setCameraMessage('');
    pendingCapture.current = 'scan';
    setCaptureRequestId(value => value + 1);
  };

  const openGallery = async () => {
    setSettingsOpen(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 6, quality: 0.85 });
      if (result.canceled || !result.assets.length) return;
      setJourneyItems([]);
      setActiveJourney(null);
      setScanMode('auto');
      setScanSource('gallery');
      setScanPhotos(result.assets.slice(0,6).map(a=>a.uri));
    } catch { setCameraMessage('Could not open your photo library. Please try again.'); }
  };

  const labelSignalsByBottle = associateLabelSignalsToBottles(liveBottleTracks.map(track => track.bottle.box), liveTextItems, liveBarcodeItems);

  if (!permission) return <View style={s.loading}><Text style={s.loadingText}>DISCOVER</Text></View>;

  return (
    <View style={s.root}>
      {permission.granted ? (
        <DiscoverARSurface
          style={StyleSheet.absoluteFill}
          active={!!permission.granted}
          recognitionEnabled={shouldEnableLiveRecognition({ cameraGranted: !!permission.granted, reviewingCapture: !!scanPhotos, scanMode, activePanel, platform: Platform.OS })}
          captureRequestId={captureRequestId}
          spatialAnchors={liveSpatialAnchors}
          onCapturedImage={handleCapturedImage}
          onTrackingUpdate={event => setLiveTracking(event.nativeEvent)}
          onDepthStatus={event => setLiveDepthStatus(event.nativeEvent.status)}
          onDepthEstimate={event => { const value = event.nativeEvent; if ('depthMeters' in value) { setLiveDepthFrame(value); depthFramesRef.current = [...depthFramesRef.current.filter(frame => value.timestamp - frame.timestamp <= 8 && frame.timestamp <= value.timestamp), value].slice(-20); if (liveBottleFrameTimestamp !== null && Math.abs(value.timestamp - liveBottleFrameTimestamp) <= 0.20) setLiveBottleDepthFrame(current => current ?? value); } }}
          onVisualCandidates={event => {
            const candidates = event.nativeEvent.candidates;
            if (event.nativeEvent.source !== 'cloud' || candidates.length > 0) {
              setLiveBottleTracks(previous => mergeTrackedBottleCandidates(previous, candidates));
            }
            setLiveCandidates(candidates.map(({ trackId, x, y, width, height, confidence }) => ({ trackId, x, y, width, height, confidence })));
          }}
          onRecognitionUpdate={event => {
            const value = event.nativeEvent;
            if (value.bottles) {
              setLiveBottles(value.bottles);
              setLivePhysicalIds(value.bottles.map(() => ''));
              setLiveReadAt(Date.now());
              setLiveBottleFrameTimestamp(value.frameTimestamp);
              const nearestDepth = depthFramesRef.current.reduce<ARKitDepthFrame | null>((best, frame) => {
                if (!best) return frame;
                return Math.abs(frame.timestamp - value.frameTimestamp) < Math.abs(best.timestamp - value.frameTimestamp) ? frame : best;
              }, null);
              setLiveBottleDepthFrame(nearestDepth && Math.abs(nearestDepth.timestamp - value.frameTimestamp) <= 0.20 ? nearestDepth : null);
              // These coordinates are only accepted from the cloud response
              // carrying the same-frame Vision signals, never from a newer
              // standalone OCR callback.
              setLiveBarcodes(value.barcodes || []);
              setLiveLabelText(value.text || []);
              setLiveTextItems(value.textItems || []);
              setLiveBarcodeItems(value.barcodeItems || []);
            }
            if (value.menu) setLiveMenu(value.menu);
          }}
          onARError={event => { pendingCapture.current = null; setCapturing(false); setCameraMessage(event.nativeEvent.message || 'Camera session failed.'); }}
        />
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
      {permission.granted && !scanPhotos && liveBottleTracks.length > 0 && (
        <View pointerEvents="none" style={s.liveDetectionLayer}>
          {liveBottleTracks.slice(0, 8).map((record, index) => {
            const bottle = record.bottle;
            const name = [bottle.match?.brand || bottle.brand, bottle.product].filter(Boolean).join(' ').trim();
            const renderBox = record;
            return (
              <View key={renderBox.trackId} style={[s.liveDetectionBox, { left: ((renderBox.x * 100) + '%') as `${number}%`, top: ((renderBox.y * 100) + '%') as `${number}%`, width: ((renderBox.width * 100) + '%') as `${number}%`, height: ((renderBox.height * 100) + '%') as `${number}%` }]}>
                <View style={s.liveDetectionLabel}>
                  <Text numberOfLines={1} style={s.liveDetectionName}>{name || bottle.category.replace(/_/g, ' ').toUpperCase()}</Text>
                  <Text style={s.liveDetectionConfidence}>{Math.round(record.confidence * 100)}% · LIVE</Text>
                  <Text style={s.liveDetectionConfidence}>TRACK · {record.trackId}</Text>
                  {!!(labelSignalsByBottle[index]?.text.length || labelSignalsByBottle[index]?.barcodes.length) && <Text numberOfLines={2} style={s.liveDetectionConfidence}>{[...(labelSignalsByBottle[index]?.text || []).slice(0, 2), ...(labelSignalsByBottle[index]?.barcodes || []).map(code => `BAR ${code}`)].join(' · ')}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
      {!!cameraMessage && <View style={[s.cameraMessage, { top: Math.max(insets.top, 24) + 75 }]}><Text style={s.cameraMessageText}>{cameraMessage}</Text></View>}
      <View style={[s.topBar, { top: Math.max(insets.top, Platform.OS === 'ios' ? 12 : 8) + 10 }]}>
        <View><Text style={s.wordmark}>HARMONY</Text><Text style={s.wordmarkSub}>D I S C O V E R</Text></View>
        <View style={s.topActions}><View style={s.livePill}><View style={s.liveDot}/><Text style={s.liveText}>VIEWFINDER</Text></View><Pressable style={s.profileButton} onPress={() => setActivePanel('favorites')}><Ionicons name="person-outline" size={19} color={C.ivory} /></Pressable></View>
      </View>
      <View style={[s.centerHint, { top: Math.max(insets.top, 24) + 112, bottom: Math.max(insets.bottom, 12) + (screenHeight < 750 ? 218 : 238) }]} pointerEvents="none">
        <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} /><View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
        <Text style={s.centerHintText}>FIND THE DRINK WORTH TALKING ABOUT</Text>
      </View>
      <View style={[s.bottomArea, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 6) + (isLandscape ? 5 : 7), paddingTop: isLandscape ? 6 : 8, left: isLandscape ? 22 : 10, right: isLandscape ? 22 : 10 }]}>
        <View style={s.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Favorites" style={s.utilityControl} onPress={() => setActivePanel('favorites')}><Ionicons name="heart-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>FAVORITES</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Nearby discoveries" style={s.utilityControl} onPress={() => setActivePanel('nearby')}><Ionicons name="compass-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>NEARBY</Text></Pressable>
          <View style={s.centerControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose photos from gallery" style={[s.primaryControl, s.primaryControlHalf]} onPress={openGallery}><Ionicons name="images-outline" size={compactDock ? 11 : 12} color={C.ivory} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={capturing ? 'Capturing scan' : scanMode === 'menu' ? 'Capture menu page' : scanMode === 'bottle' ? 'Capture bottle' : 'Capture scan'} disabled={capturing} style={[s.shutterOuter, compactDock && s.shutterOuterCompact, capturing && s.shutterBusy]} onPress={capture}><View style={[s.shutterInner, compactDock && s.shutterInnerCompact]}>{capturing && <Text style={s.shutterBusyText}>…</Text>}</View></Pressable>

          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" style={s.utilityControl} onPress={() => setSettingsOpen(v => !v)}><Ionicons name="settings-outline" size={compactDock ? 14 : 16} color={C.ivory} /><Text style={s.utilityLabel}>SETTINGS</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Marty" style={s.utilityControl} onPress={() => setActivePanel('marty')}><Ionicons name="chatbubble-ellipses-outline" size={compactDock ? 15 : 17} color={C.brass} /><Text style={[s.utilityLabel, { color: C.brass }]}>MARTY</Text></Pressable>
        </View>
      </View>
      {scanPhotos && <View style={{position:'absolute',zIndex:50,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><LiveScanner photos={scanPhotos} source={scanSource} mode={scanMode} onClose={()=>setScanPhotos(null)} onJourneyItems={setJourneyItems} onKeepMenu={()=>{setScanPhotos(null);setActivePanel('menu');}} /></View>}
      {activePanel === 'menu' && <View style={{position:'absolute',zIndex:40,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><PreviewPanel onClose={()=>setActivePanel(null)} onAddPages={addMenuPages} /></View>}
      {activePanel === 'inventory' && <View style={{position:'absolute',zIndex:40,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><LiveInventoryPanel onClose={()=>setActivePanel(null)} tracking={liveTracking} depthStatus={liveDepthStatus} depthFrame={liveDepthFrame} candidates={liveCandidates} bottles={liveBottles} barcodes={liveBarcodes} labelText={liveLabelText} menu={liveMenu} lastReadAt={liveReadAt} textItems={liveTextItems} barcodeItems={liveBarcodeItems} /></View>}
      {activePanel && activePanel !== 'inventory' && activePanel !== 'menu' && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Close panel" onPress={()=>setActivePanel(null)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:30,backgroundColor:activePanel==='lidar'?'rgba(0,0,0,0.08)':'rgba(0,0,0,0.42)'}} />
        <View style={{position:'absolute',zIndex:31,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:activePanel==='lidar'?'46%':activePanel==='nearby'?'88%':undefined,maxHeight:activePanel==='lidar'?'50%':activePanel==='nearby'?'90%':'78%',padding:activePanel==='lidar'?10:activePanel==='nearby'?8:16,borderRadius:20,backgroundColor:'rgba(10,13,18,0.98)',borderWidth:1,borderColor:'rgba(198,163,106,0.48)'}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:activePanel==='nearby'?4:10}}>
            <Text style={{color:C.ivory,fontSize:activePanel==='nearby'?10:12,fontWeight:'900',letterSpacing:1.5}}>{({favorites:'FAVORITES',nearby:'NEARBY ATLAS',marty:'MARTY SULLIVAN',privacy:'PRIVACY & CONTRIBUTIONS',inventory:'LIVE INVENTORY SCANNER',lidar:'LIVE 3D / LIDAR SCANNER',collection:'MY COLLECTION',taste:'MY TASTE'} as const)[activePanel]}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close panel" onPress={()=>setActivePanel(null)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable>
          </View>
          {activePanel!=='lidar' && activePanel!=='nearby' && <Text style={{color:C.ivory,fontSize:14,fontWeight:'800',marginBottom:6}}>{activePanel==='favorites'?'Your saved discoveries':activePanel==='marty'?'Your beverage guide, on this camera screen':activePanel==='privacy'?'Your data and contribution choices':activePanel==='collection'?'Your saved beverage discoveries':'Your personal flavor profile'}</Text>}
          {activePanel==='lidar' ? <LidarScannerPanel onClose={()=>setActivePanel(null)} tracking={liveTracking} depthStatus={liveDepthStatus} depthFrame={liveDepthFrame} candidates={liveCandidates} bottles={liveBottles} onSpatialAnchors={() => { /* Shared physical tracker is owned by the home viewfinder. */ }} /> : activePanel==='privacy' ? <PrivacyPanel/> : activePanel==='nearby' ? <NearbyPanel command={nearbyCommand} onCommandResult={handleNearbyCommandResult} journeyItems={journeyItems} onOpenJourney={setActiveJourney}/> : activePanel==='marty' ? <MartyPanel onOpenSettings={()=>setMartyConsentOpen(true)} onNavigateCommand={handleMartyAppCommand}/> : <Text style={{color:C.muted,fontSize:11,lineHeight:17}}>{activePanel==='favorites'?'Your saved items will appear here. No saved discoveries are currently loaded.':activePanel==='collection'?'Your saved drinks, bottles, wines and Journeys will appear here. Collection sync is not enabled yet.':activePanel==='taste'?'Your optional flavor profile will develop from discoveries you choose to save. Taste profiling is not active yet.':'3D depth scanning depends on supported native device capabilities and is not available as a web-page route.'}</Text>}
          {activePanel==='marty' && martyConsentOpen && <>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Marty consent settings" onPress={()=>setMartyConsentOpen(false)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:80,backgroundColor:'rgba(0,0,0,0.48)'}} />
            <View style={{position:'absolute',zIndex:81,left:0,right:0,bottom:0,maxHeight:'88%',padding:12,borderTopLeftRadius:18,borderTopRightRadius:18,backgroundColor:'rgba(10,13,18,0.995)',borderWidth:1,borderColor:'rgba(198,163,106,0.7)'}}>
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}><Text style={{color:C.ivory,fontSize:11,fontWeight:'900',letterSpacing:1.3}}>MARTY · VOICE & MEMORY CONSENT</Text><Pressable onPress={()=>setMartyConsentOpen(false)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable></View>
              <MartyConsentPanel />
            </View>
          </>}
        </View>
      </>}
      {activeJourney && <JourneyPlayerOverlay item={activeJourney} onClose={()=>setActiveJourney(null)}/>}
      {settingsOpen && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss settings menu" onPress={()=>setSettingsOpen(false)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:60,backgroundColor:'transparent'}} />
        <View style={{position:'absolute',zIndex:61,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,maxHeight:screenHeight*0.78,padding:16,borderRadius:20,backgroundColor:'rgba(10,13,18,0.99)',borderWidth:1,borderColor:'rgba(198,163,106,0.65)',shadowColor:'#000',shadowOpacity:0.45,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:24}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <Text style={{color:C.ivory,fontSize:12,fontWeight:'900',letterSpacing:1.5}}>DISCOVER SETTINGS</Text>
            <Pressable onPress={()=>setSettingsOpen(false)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable style={s.menuRow} onPress={()=>setCameraMessage('Screen orientation is automatic. Rotate your device to change the layout.')}><Ionicons name="phone-portrait-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Screen orientation</Text><Text style={s.menuDesc}>Automatic · portrait and landscape</Text></View><Text style={s.menuValue}>AUTO</Text></Pressable>
          <Pressable style={s.menuRow} onPress={async()=>{const p=permission?.granted?permission:await requestPermission();setCameraMessage(p.granted?'Camera access is enabled.':'Camera access was not granted. Check iOS Settings.');}}><Ionicons name="camera-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Camera access</Text><Text style={s.menuDesc}>Manage camera permission</Text></View><Text style={s.menuValue}>{permission.granted?'ON':'CHECK'}</Text></Pressable>
          <Pressable style={s.menuRow} onPress={()=>setCameraMessage('Photos are processed only after you select or capture them.')}><Ionicons name="images-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Photo processing</Text><Text style={s.menuDesc}>Review selected photos before processing</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);setActivePanel('privacy');}}><Ionicons name="shield-checkmark-outline" size={17} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Measure & contribution permissions</Text><Text style={s.menuDesc}>Optional research and measurement sharing</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <View style={{height:1,backgroundColor:C.line,marginVertical:8}}/>
          <Text style={{color:C.brass,fontSize:9,fontWeight:'900',letterSpacing:1.4,marginBottom:4}}>ADVANCED SCANNERS</Text>
          <Pressable style={s.menuRow} onPress={startMenuScan}><Ionicons name="document-text-outline" size={18} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Read a menu</Text><Text style={s.menuDesc}>Capture menu pages, review extracted items and corrections</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={startBottleScan}><Ionicons name="wine-outline" size={18} color={C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Scan a bottle</Text><Text style={s.menuDesc}>Identify labels, products, SKUs, vintages and research details</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);setActivePanel('inventory');}}><Ionicons name="scan-outline" size={18} color="#7DFFB5"/><View style={{flex:1}}><Text style={s.menuTitle}>Live Inventory Scanner</Text><Text style={s.menuDesc}>Live camera · OCR and barcode signals · product match pending</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          <Pressable style={s.menuRow} onPress={()=>{setSettingsOpen(false);setActivePanel('lidar');}}><Ionicons name="cube-outline" size={18} color="#4F8BFF"/><View style={{flex:1}}><Text style={s.menuTitle}>Live 3D / LiDAR Scanner</Text><Text style={s.menuDesc}>ARKit depth and world-tracking test · capability dependent</Text></View><Ionicons name="chevron-forward" size={15} color={C.muted}/></Pressable>
          </ScrollView>
        </View>
      </>}
    </View>
  );
}
const s = StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},menuRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:11,paddingVertical:7,borderBottomWidth:1,borderBottomColor:'rgba(153,163,174,0.12)'},menuTitle:{color:C.ivory,fontSize:11,fontWeight:'800'},menuDesc:{color:C.muted,fontSize:9,marginTop:3},menuValue:{color:C.brass,fontSize:8,fontWeight:'900',letterSpacing:1},cameraMessage:{position:'absolute',left:24,right:24,zIndex:20,padding:11,borderRadius:10,backgroundColor:'rgba(8,10,13,0.94)',borderWidth:1,borderColor:C.line},cameraMessageText:{color:C.ivory,fontSize:11,lineHeight:16,textAlign:'center'},loading:{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},loadingText:{color:C.brass,letterSpacing:5,fontWeight:'800'},
 permissionFallback:{backgroundColor:'#090B0F',alignItems:'center',justifyContent:'center'},permissionCard:{position:'absolute',left:28,right:28,top:'35%',padding:22,borderRadius:18,backgroundColor:'rgba(9,11,14,0.92)',borderWidth:1,borderColor:C.line},permissionTitle:{color:C.ivory,fontSize:23,fontWeight:'700',marginTop:12},permissionBody:{color:C.muted,fontSize:13,lineHeight:20,marginTop:7},permissionButton:{backgroundColor:C.brass,padding:14,borderRadius:10,alignItems:'center',marginTop:18},permissionButtonText:{color:'#111',fontSize:11,fontWeight:'900',letterSpacing:1.5},
 viewfinderShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(3,5,8,0.25)'},liveDetectionLayer:{...StyleSheet.absoluteFillObject,zIndex:5},liveDetectionBox:{position:'absolute',borderWidth:1.5,borderColor:'#77E5B5',borderRadius:8,backgroundColor:'rgba(54,190,135,0.035)'},liveDetectionLabel:{position:'absolute',left:-1,top:-29,maxWidth:210,minWidth:96,paddingHorizontal:8,paddingVertical:4,borderTopLeftRadius:6,borderTopRightRadius:6,borderBottomRightRadius:6,backgroundColor:'rgba(5,15,16,0.92)',borderWidth:1,borderColor:'rgba(119,229,181,0.8)'},liveDetectionName:{color:'#E9FFF5',fontSize:9,fontWeight:'900',letterSpacing:0.3},liveDetectionConfidence:{color:'#77E5B5',fontSize:7,fontWeight:'800',marginTop:2,letterSpacing:0.7},topBar:{position:'absolute',top:Platform.OS==='ios'?62:34,left:22,right:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},wordmark:{color:C.ivory,fontSize:17,fontWeight:'900',letterSpacing:4},wordmarkSub:{color:C.brass,fontSize:8,fontWeight:'700',letterSpacing:2.5,marginTop:4},topActions:{flexDirection:'row',alignItems:'center',gap:9},livePill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:9,paddingVertical:7,borderRadius:14,backgroundColor:'rgba(8,10,13,0.7)',borderWidth:1,borderColor:'rgba(153,163,174,0.18)'},liveDot:{width:5,height:5,borderRadius:3,backgroundColor:'#B75D55'},liveText:{color:C.ivory,fontSize:9,fontWeight:'800',letterSpacing:1},profileButton:{width:34,height:34,borderRadius:17,backgroundColor:'rgba(8,10,13,0.7)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},
 centerHint:{position:'absolute',left:26,right:26,justifyContent:'center',alignItems:'center'},centerHintText:{color:'rgba(240,241,242,0.68)',fontSize:9,letterSpacing:2.4,fontWeight:'700'},corner:{position:'absolute',width:25,height:25,borderColor:'rgba(198,163,106,0.8)'},tl:{top:0,left:0,borderTopWidth:1,borderLeftWidth:1},tr:{top:0,right:0,borderTopWidth:1,borderRightWidth:1},bl:{bottom:0,left:0,borderBottomWidth:1,borderLeftWidth:1},br:{bottom:0,right:0,borderBottomWidth:1,borderRightWidth:1},
 bottomArea:{position:'absolute',bottom:0,backgroundColor:'rgba(7,9,12,0.92)',borderTopWidth:1,borderColor:C.line,borderTopLeftRadius:20,borderTopRightRadius:20,paddingHorizontal:8},controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4},utilityControl:{alignItems:'center',justifyContent:'center',gap:5,minWidth:42,paddingVertical:7},utilityLabel:{color:C.ivory,fontSize:7,fontWeight:'800',letterSpacing:0.7},centerControls:{flexDirection:'row',alignItems:'center',gap:8},primaryControl:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(20,24,30,0.9)'},primaryControlHalf:{width:30,height:30},primaryControlActive:{borderColor:C.brass},shutterOuter:{width:66,height:66,borderRadius:33,borderWidth:2,borderColor:C.ivory,alignItems:'center',justifyContent:'center'},shutterOuterCompact:{width:58,height:58},shutterInner:{width:52,height:52,borderRadius:26,backgroundColor:C.ivory},shutterInnerCompact:{width:44,height:44},shutterBusy:{opacity:0.55},shutterBusyText:{color:'#111',textAlign:'center',fontSize:20,fontWeight:'900',lineHeight:50}
});
