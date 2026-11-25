import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions, ScrollView, Animated, Easing, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useScan } from '../src/state/ScanContext';
import LiveScanner from '../src/live/LiveScanner';
import { DiscoverARSurface, type ARTrackingUpdate, type ARKitCameraPose, type UserChoice } from '../src/live/DiscoverARSurface';
import { WorldBottleAnchorOverlay } from '../src/live/WorldBottleAnchorOverlay';
import { emptyCandidatesAction } from '../src/live/worldAnchorFramePolicy';
import type { ARKitDepthFrame } from '../src/live/DiscoverARSurface';
import type { BottleRead, MenuGlimpse, BottleIntelligenceProfile } from '../src/services/discoverLiveApi';
import { loadBottleCard } from '../src/services/discoverLiveApi';
import { missingProfileFields } from '../src/home-panels/profileFields';
import { attachBottleReadsToCandidates } from '../src/services/bottleCandidateAssociation';
import { BottleProfilePanel } from '../src/home-panels/BottleProfilePanel';
import { shouldEnableLiveRecognition } from '../src/live/recognitionPolicy';
import PrivacyPanel from '../src/home-panels/PrivacyPanel';
import NearbyPanel from '../src/home-panels/NearbyPanel';
import VenueCheckinPrompt from '../src/home-panels/VenueCheckinPrompt';
import { useVenueCheckin } from '../src/services/useVenueCheckin';
import { fetchVenueFeed } from '../src/services/discoverVenueApi';
import { sceneFromVenueFeed, type PriorName } from '../src/live/partialEvidence';
import JourneyPlayerOverlay, { type JourneyScanItem } from '../src/home-panels/JourneyPlayerOverlay';
import { MartyPanel } from '../src/home-panels/MartyPanel';
import { MartyConsentPanel } from '../src/home-panels/MartyConsentPanel';
import LidarScannerPanel from '../src/home-panels/LidarScannerPanel';
import { LiveInventoryPanel } from './live-inventory';
import { PreviewPanel } from './preview';
import { FoundTray, FoundFlightLabel, type FoundFlight } from '../src/live/FoundTray';
import { publishScreenContext } from '../src/voice/screenContext';
import { displayName, mergeFound, type FoundItem } from '../src/live/foundTray';
import { clientLog, installClientLog } from '../src/services/clientLog';
import { layoutBoxes } from '../src/live/boxDepth';
import { BoxStage } from '../src/live/BoxStage';
import { isPhoneUserAgent, textReaderEnabled } from '../src/live/labelTextReader';
import { QUICK_GUESS_DATA_NOTICE, QUICK_GUESS_DESCRIPTION } from '../src/live/quickGuessCopy';
import { forwardOnlyStage, type ShownStage, type StageMemory } from '../src/live/boxStageProgress';

const C = { bg: '#07090C', panel: 'rgba(10,12,16,0.96)', line: 'rgba(153,163,174,0.22)', brass: '#C6A36A', ivory: '#F0F1F2', muted: '#858C95', red: '#A84343', signal: '#C05A50' };
// Boxes glide to their new place (web: a short CSS transition) instead of jumping on every detector pass.
const BOX_GLIDE = (Platform.OS === 'web' ? { transitionProperty: 'left, top, width, height, border-color', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } : {}) as object;

export default function Home({ initialPanel }: { initialPanel?: 'favorites'|'nearby'|'marty'|'privacy'|'inventory'|'lidar'|'menu'|'settings'|'collection'|'taste' } = {}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { addPages, appendPages, pages } = useScan();
  const isLandscape = screenWidth > screenHeight;
  const compactDock = screenWidth < 390 || (isLandscape && screenHeight < 500);
  const [permission, requestPermission] = useCameraPermissions();
  // Remembered on this device: reopening the page must not silently switch recognition off.
  const [liveReadConsent, setLiveReadConsentState] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage?.getItem('discover.liveRecognition') === 'on'; } catch { return false; }
  });
  const setLiveReadConsent = (next: boolean | ((value: boolean) => boolean)) => setLiveReadConsentState(value => {
    const resolved = typeof next === 'function' ? next(value) : next;
    try { if (typeof window !== 'undefined') window.localStorage?.setItem('discover.liveRecognition', resolved ? 'on' : 'off'); } catch { /* private mode */ }
    return resolved;
  });
  // Settings > Quick Guess (remembered on this device; same switch as ?ocr=on / ?ocr=off).
  // Phones: Quick Guess is not offered (it ran iPhones out of memory beside the bottle detector).
  const onPhone = Platform.OS !== 'web' || isPhoneUserAgent();
  const [quickGuess, setQuickGuessState] = useState(() => textReaderEnabled());
  const setQuickGuess = (next: boolean | ((value: boolean) => boolean)) => setQuickGuessState(value => {
    const resolved = typeof next === 'function' ? next(value) : next;
    try { if (typeof window !== 'undefined') window.localStorage?.setItem('discover.ocr', resolved ? 'on' : 'off'); } catch { /* private mode */ }
    return resolved;
  });
  const [capturing, setCapturing] = useState(false);
  const [captureRequestId, setCaptureRequestId] = useState(0);
  const pendingCapture = useRef<'scan'|'menu_page'|null>(null);
  const [liveTracking, setLiveTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'camera_starting' });
  const [liveDepthStatus, setLiveDepthStatus] = useState('waiting_for_depth_provider');
  const [liveDepthFrame, setLiveDepthFrame] = useState<ARKitDepthFrame | null>(null);
  // Only exact cloud-read frames with attached metric depth advance physical tracking.
  const [liveSpatialObservationFrame, setLiveSpatialObservationFrame] = useState<ARKitDepthFrame | null>(null);
  const [liveLiquidMetrics, setLiveLiquidMetrics] = useState<{jobsDispatched:number;jobsCompleted:number;framesSkipped:number;workerErrors:number;lastWorkerMs:number;maxWorkerMs:number;segmentationMs:number;localFrameMs:number;workerAvailable:boolean}>({jobsDispatched:0,jobsCompleted:0,framesSkipped:0,workerErrors:0,lastWorkerMs:0,maxWorkerMs:0,segmentationMs:0,localFrameMs:0,workerAvailable:false});
  const [liveCameraPose, setLiveCameraPose] = useState<ARKitCameraPose | null>(null);
  const [anchorSessionKey, setAnchorSessionKey] = useState(0);
  // Furthest step (1-4) each box has reached; boxes never step backwards (forgotten when the box goes).
  const stageMemoryRef = useRef(new Map<number, StageMemory>());
  const [liveCandidates, setLiveCandidates] = useState<Array<{trackId:number;x:number;y:number;width:number;height:number;confidence:number;timestamp?:number;source?:'cloud'|'local';depthFrame?:ARKitDepthFrame;contour?:Array<{x:number;y:number}>;bottle?:BottleRead;identityConfidence?:number;identifying?:number;provisional?:BottleRead;probable?:string;saved?:boolean;ask?:{choices:Array<{brand:string;product:string}>};stage?:{name:'scanning'|'zoom'|'reading'|'identifying'|'researching'|'found'|'confirm';since?:number;value?:number};liquidLevel?:{heightPercent:number;confidence:number;method:'temporal_consensus';calibratedVolume?:{milliliters:number;fluidOunces:number;profileId:string}}}>>([]);
  // Expire image-space boxes by their own source-frame age. Local detections
  // refresh continuously; cloud detections need to bridge the 4.4s read cadence.
  // A single global timeout caused cloud boxes to blink out between reads.
  useEffect(() => {
    if (!liveCandidates.length) return;
    const expiry = setInterval(() => {
      const now = Date.now();
      setLiveCandidates(current => {
        const next = current.filter(candidate => {
          if (!Number.isFinite(candidate.timestamp)) return true;
          const maxAgeMs = candidate.source === 'local' ? 1500 : 6500;
          return now - Number(candidate.timestamp) <= maxAgeMs;
        });
        return next.length === current.length ? current : next;
      });
    }, 400);
    return () => clearInterval(expiry);
  }, [liveCandidates]);
  const [liveBottles, setLiveBottles] = useState<BottleRead[]>([]);
  // Found strip: every fully recognised product flies up from its green box
  // into a thin strip at the top; tapping a chip opens a static profile.
  // Found chips survive a page reload in this tab (iPhone browsers can reload a busy camera page).
  const [foundItems, setFoundItems] = useState<FoundItem[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.sessionStorage?.getItem('discover.found') : null;
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(-40) : [];
    } catch { return []; }
  });
  useEffect(() => { installClientLog(); }, []);
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.sessionStorage?.setItem('discover.found', JSON.stringify(foundItems.slice(-40))); } catch { /* storage full or private mode */ }
  }, [foundItems]);
  const [foundFlights, setFoundFlights] = useState<FoundFlight[]>([]);
  const foundTrayTop = Math.max(insets.top, Platform.OS === 'ios' ? 12 : 8) + 50;
  const foundRef = useRef<FoundItem[]>(foundItems);
  // Scan boxes stay inside the camera view: below the found strip, above the bottom bar.
  const [bottomAreaTop, setBottomAreaTop] = useState(0);
  const cameraViewTop = foundTrayTop + 30;
  // Boxes outline labels and never overlap: a bottle behind another is hidden, neighbours are trimmed (see boxDepth.ts).
  // Named bottles always show; an unnamed box needs a little more certainty, so a busy shelf is not a wall of boxes.
  const shownCandidates = liveCandidates.filter(track => track.confidence >= (track.bottle ? 0.45 : 0.55) && !(track.depthFrame?.unit === 'meters' && track.timestamp === track.depthFrame.timestamp));
  const boxLayout = layoutBoxes(shownCandidates);
  for (const id of [...stageMemoryRef.current.keys()]) if (!liveCandidates.some(c => c.trackId === id)) stageMemoryRef.current.delete(id);
  const cameraViewBottom = bottomAreaTop > cameraViewTop ? bottomAreaTop - 4 : screenHeight - 150;
  // A bottle counts as done (solid green ✓, chip in the strip) once it is saved or being researched; if saving is
  // slow it still counts after 3 s, so a chip never waits forever.
  const namedSinceRef = useRef(new Map<number, number>());
  const isDone = (track: (typeof liveCandidates)[number]) => {
    if (!track.bottle) return false;
    if (track.saved || track.stage?.name === 'researching') return true;
    const since = namedSinceRef.current.get(track.trackId);
    return since !== undefined && Date.now() - since >= 3_000;
  };
  useEffect(() => {
    const now = Date.now();
    for (const track of liveCandidates) if (track.bottle && !namedSinceRef.current.has(track.trackId)) namedSinceRef.current.set(track.trackId, now);
    for (const id of [...namedSinceRef.current.keys()]) if (!liveCandidates.some(track => track.trackId === id) && namedSinceRef.current.size > 200) namedSinceRef.current.delete(id);
  }, [liveCandidates]);
  useEffect(() => {
    // Only a box that is drawn on screen and done sends its chip to the strip (Rob, 17 Nov 2026: chips flew up
    // before their boxes showed).
    const ready = liveCandidates.filter(track => isDone(track) && boxLayout.has(track.trackId));
    if (!ready.length) return;
    const { list, added } = mergeFound(foundRef.current, ready, Date.now());
    if (list === foundRef.current) return;
    foundRef.current = list;
    setFoundItems(list);
    if (added.length) {
      clientLog({ evt: 'found_added', chips: list.length, conf: (added[0]!.candidate as { identityConfidence?: number }).identityConfidence });
      setFoundFlights(flights => [...flights, ...added.map(({ item, candidate }, index) => ({
        id: item.key + ':' + item.firstSeenAt,
        key: item.key,
        startedAt: Date.now(),
        name: item.name,
        from: { x: Math.max(4, Math.min(screenWidth - 120, candidate.x * screenWidth)), y: Math.max(foundTrayTop, candidate.y * screenHeight - 29) },
        to: { x: Math.max(8, screenWidth - 236) - index * 4, y: foundTrayTop + 2 },
      }))]);
    }
  }, [liveCandidates, screenWidth, screenHeight, foundTrayTop]);
  // A chip is hidden only while its label is flying (under a second). Flights
  // are cleared by a timer too, so a chip can never stay hidden if the
  // animation does not report that it finished.
  useEffect(() => {
    if (!foundFlights.length) return;
    const timer = setTimeout(() => setFoundFlights(flights => flights.filter(flight => Date.now() - flight.startedAt < 900)), 950);
    return () => clearTimeout(timer);
  }, [foundFlights]);
  const foundKeysInFlight = new Set(foundFlights.filter(flight => Date.now() - flight.startedAt < 900).map(flight => flight.key));
  // Profile card for a chip in the found strip. It follows that chip's entry,
  // so new label reads fill in while it is open, and research is re-checked
  // every 8 s. It grows out of the chip that was tapped.
  const [selectedFoundKey, setSelectedFoundKey] = useState<string | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<{ x: number; y: number } | null>(null);
  const [seenVersions, setSeenVersions] = useState<Record<string, number>>({});
  const selectedFound = selectedFoundKey ? foundItems.find(item => item.key === selectedFoundKey) ?? null : null;
  const selectedBottle: BottleRead | null = selectedFound?.bottle ?? null;
  useEffect(() => {
    if (!selectedFound) return;
    setSeenVersions(seen => seen[selectedFound.key] === selectedFound.version ? seen : { ...seen, [selectedFound.key]: selectedFound.version });
  }, [selectedFound?.key, selectedFound?.version]);
  const unseenFoundKeys = new Set(foundItems.filter(item => item.key !== selectedFoundKey && item.version > (seenVersions[item.key] ?? 1)).map(item => item.key));
  const openFoundItem = (item: FoundItem, from: { x: number; y: number }) => {
    setSelectedFrom(from);
    setSelectedFoundKey(item.key);
  };
  // Venue check-in: after a scan, suggest the closest venue and ask (never silent).
  const venueCheckin = useVenueCheckin();
  const lastLiveCheckinPrompt = useRef(0);
  useEffect(() => {
    if (!liveBottles.length || Date.now() - lastLiveCheckinPrompt.current < 2 * 60 * 1000) return;
    lastLiveCheckinPrompt.current = Date.now();
    void venueCheckin.afterScan('live_scan');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBottles.length > 0]);
  // While checked in: the bottles seen at this venue and the items on its scanned menus tip close calls on
  // partly hidden labels ("Probably …" only; nothing is saved from them).
  const [sceneNames, setSceneNames] = useState<PriorName[]>([]);
  // "Which one is it?": the bottle the person tapped, and what they picked (sent to the camera surface).
  const [userChoices, setUserChoices] = useState<UserChoice[]>([]);
  const [askingTrack, setAskingTrack] = useState<{ trackId: number; seen: string; choices: Array<{ brand: string; product: string }> } | null>(null);
  const [typedName, setTypedName] = useState('');
  const answerAsk = (choice: { brand?: string; product?: string; none?: boolean }) => {
    if (!askingTrack) return;
    setUserChoices(previous => [...previous.slice(-40), { trackId: askingTrack.trackId, at: Date.now(), ...choice }]);
    setAskingTrack(null);
    setTypedName('');
  };
  const checkedInVenueRef = venueCheckin.active?.venueRef ?? null;
  useEffect(() => {
    if (!checkedInVenueRef) { setSceneNames([]); return; }
    let live = true;
    fetchVenueFeed(checkedInVenueRef).then(feed => { if (live) setSceneNames(sceneFromVenueFeed(feed)); }).catch(() => { if (live) setSceneNames([]); });
    return () => { live = false; };
  }, [checkedInVenueRef]);
  const [selectedBottleIntelligence, setSelectedBottleIntelligence] = useState<BottleIntelligenceProfile | null>(null);
  const [selectedBottleIntelligenceLoading, setSelectedBottleIntelligenceLoading] = useState(false);
  const closeProfile = () => {
    setSelectedFoundKey(null);
    setSelectedBottleIntelligence(null);
  };
  const selectedBottleRef = useRef<BottleRead | null>(null);
  selectedBottleRef.current = selectedBottle ?? null;
  const selectedBottleBrand = selectedBottle?.match?.brand || selectedBottle?.brand || '';
  const selectedBottleProduct = selectedBottle?.match?.product || selectedBottle?.product || '';
  const selectedBottleCategory = selectedBottle?.category || 'other';
  useEffect(() => {
    let cancelled = false;
    if (!selectedBottleBrand.trim()) {
      setSelectedBottleIntelligence(null);
      setSelectedBottleIntelligenceLoading(false);
      return () => { cancelled = true; };
    }
    setSelectedBottleIntelligence(null);
    setSelectedBottleIntelligenceLoading(true);
    // The empty categories are sent so the server can research them (once per product every 6 h).
    const load = (first: boolean) => loadBottleCard({
      brand: selectedBottleBrand,
      product: selectedBottleProduct,
      category: selectedBottleCategory,
    }, selectedBottleRef.current ? missingProfileFields(selectedBottleRef.current, null) : [])
      // A later check only replaces what is shown when it found something.
      .then(profile => { if (!cancelled && (first || profile)) setSelectedBottleIntelligence(profile); })
      .catch(() => { if (!cancelled && first) setSelectedBottleIntelligence(null); })
      .finally(() => { if (!cancelled && first) setSelectedBottleIntelligenceLoading(false); });
    void load(true);
    // Research runs in the background after a bottle is saved: keep checking while the card is open.
    const refresh = setInterval(() => { void load(false); }, 8_000);
    return () => { cancelled = true; clearInterval(refresh); };
  }, [selectedBottleBrand, selectedBottleProduct, selectedBottleCategory]);
  const profileGrow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!selectedFoundKey) return;
    profileGrow.setValue(0);
    Animated.timing(profileGrow, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [selectedFoundKey, profileGrow]);
  const [liveBarcodes, setLiveBarcodes] = useState<Array<{value:string;symbology:string}>>([]);
  const [liveLabelText, setLiveLabelText] = useState<string[]>([]);
  const [liveMenu, setLiveMenu] = useState<MenuGlimpse | null>(null);
  const [liveReadAt, setLiveReadAt] = useState<number | null>(null);
  const [cameraMessage, setCameraMessage] = useState('');
  useEffect(() => {
    if (!liveReadAt) return;
    const staleTimer = setTimeout(() => {
      setLiveBottles([]);
      setLiveCandidates([]);
      setLiveBarcodes([]);
      setLiveLabelText([]);
      setLiveReadAt(null);
    }, 12000);
    return () => clearTimeout(staleTimer);
  }, [liveReadAt]);
  const [scanPhotos, setScanPhotos] = useState<string[] | null>(null);
  const [scanSource, setScanSource] = useState<'camera'|'gallery'>('camera');
  const [scanMode, setScanMode] = useState<'bottle'|'menu'|'auto'>('auto');
  const [journeyItems, setJourneyItems] = useState<JourneyScanItem[]>([]);
  const [activeJourney, setActiveJourney] = useState<JourneyScanItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(initialPanel === 'settings');
  const [martyConsentOpen, setMartyConsentOpen] = useState(false);
  // Tell Marty what is on screen (menu lines, bottle in view, the open Journey or recipe) whenever it changes.
  useEffect(() => {
    publishScreenContext({
      menu: liveMenu?.visible && liveMenu.items.length ? { title: liveMenu.title, lines: liveMenu.items } : null,
      bottles: liveBottles.filter(b => b.state !== 'unsure').map(b => ({ brand: b.resolved?.brand ?? b.brand, product: b.product, category: b.category })),
      journey: activeJourney ? { kind: activeJourney.kind, name: activeJourney.name } : null,
    });
  }, [liveMenu, liveBottles, activeJourney]);
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
      void venueCheckin.afterScan('menu_scan');
      return;
    }
    // Camera captures only (gallery photos may be from somewhere else).
    void venueCheckin.afterScan(scanMode === 'menu' ? 'menu_scan' : 'bottle_scan');
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

  if (!permission) return <View style={s.loading}><Text style={s.loadingText}>DISCOVER</Text></View>;

  return (
    <View style={s.root}>
      {permission.granted ? (
        <DiscoverARSurface
          style={StyleSheet.absoluteFill}
          active={!!permission.granted && !scanPhotos}
          recognitionEnabled={liveReadConsent && shouldEnableLiveRecognition({ cameraGranted: !!permission.granted, reviewingCapture: !!scanPhotos, scanMode, activePanel, platform: Platform.OS })}
          captureRequestId={captureRequestId}
          quickGuess={quickGuess}
          sceneNames={sceneNames}
          userChoices={userChoices}
          onCapturedImage={handleCapturedImage}
          onTrackingUpdate={event => {
            const tracking = event.nativeEvent;
            setLiveTracking(tracking);
            if (tracking.state === 'paused' || tracking.state === 'interrupted' || tracking.state === 'not_available') {
              // A camera lifecycle transition ends the visible candidate epoch.
              // Keep an open profile as a snapshot, but clear all overlays and
              // force world anchors to start a fresh session.
              setLiveCandidates([]);
              setLiveSpatialObservationFrame(null);
              setLiveDepthFrame(null);
              setLiveCameraPose(null);
              setAnchorSessionKey(value => value + 1);
            }
          }}
          onARReady={event => {
            if (event.nativeEvent.state === 'starting') {
              // A new camera session may reuse numeric track IDs. Keep an open
              // profile as a snapshot, but detach it from the previous session.
              setAnchorSessionKey(value => value + 1);
              setLiveCandidates([]);
              setLiveDepthFrame(null);
              setLiveSpatialObservationFrame(null);
              setLiveCameraPose(null);
            }
          }}
          onDepthStatus={event => setLiveDepthStatus(event.nativeEvent.status)}
          onLiquidMetrics={event => setLiveLiquidMetrics(event.nativeEvent)}
          onDepthEstimate={event => { const value = event.nativeEvent; if ('depthMeters' in value) setLiveDepthFrame(value); }}
          onCameraPose={event => setLiveCameraPose(event.nativeEvent)}
          onVisualCandidates={event => {
            const value = event.nativeEvent;
            if (!value.candidates.length) {
              setLiveCandidates([]);
              // One empty read is a miss, not a new world: only an explicit session end resets anchors.
              const action = emptyCandidatesAction(value);
              if (action === 'reset') {
                setLiveSpatialObservationFrame(null);
                setAnchorSessionKey(session => session + 1);
              } else if (action === 'miss') {
                setLiveSpatialObservationFrame(value.depthFrame!);
              }
              return;
            }
            // On the web the camera surface already decides names from agreeing
            // reads; attaching raw cloud reads here would bypass that check.
            setLiveCandidates((Platform.OS === 'web' ? value.candidates : attachBottleReadsToCandidates(value.candidates, liveBottles)).map(candidate => ({
              ...candidate,
              source: candidate.source ?? value.source ?? (value.depthFrame?.unit === 'meters' ? 'cloud' : undefined),
              depthFrame: value.depthFrame,
            })));
            // Local Vision propagation is image-space only; it must not age or
            // confirm physical tracks. Only the cloud frame carries exact depth.
            if (value.source !== 'local' && value.depthFrame?.unit === 'meters') {
              setLiveSpatialObservationFrame(value.depthFrame);
            }
          }}
          onRecognitionUpdate={event => {
            const value = event.nativeEvent;
            if (value.bottles) {
              setLiveBottles(value.bottles);
              setLiveReadAt(value.frameTimestamp);
              if (Platform.OS !== 'web') setLiveCandidates(previous => attachBottleReadsToCandidates(previous, value.bottles || []));
            }
            if (value.barcodes?.length) setLiveBarcodes(previous => { const merged = [...previous]; value.barcodes!.forEach(barcode => { if (!merged.some(item => item.value === barcode.value)) merged.push(barcode); }); return merged.slice(-12); });
            if (value.text?.length) setLiveLabelText(previous => Array.from(new Set([...previous, ...value.text!])).slice(-24));
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
      {permission.granted && !scanPhotos && shownCandidates.length > 0 && (
        <View pointerEvents="box-none" style={[s.cameraViewClip, { top: cameraViewTop, height: Math.max(0, cameraViewBottom - cameraViewTop) }]}>
        <View pointerEvents="box-none" style={[s.liveDetectionLayer, { top: -cameraViewTop, height: screenHeight, bottom: undefined }]}>
          {shownCandidates
            // Draw big boxes first so a smaller (nearer or front) bottle's box sits on top and can be tapped.
            .slice().sort((a, b) => b.width * b.height - a.width * a.height)
            .map(tracked => {
            const bottle = tracked.bottle;
            const placed = boxLayout.get(tracked.trackId);
            if (!placed) return null;   // behind a bottle in front of it
            const left = Math.max(0, Math.min(1, placed.x));
            const top = Math.max(0, Math.min(1, placed.y));
            const trackedWidth = Math.max(0.03, Math.min(1 - left, placed.width));
            const trackedHeight = Math.max(0.04, Math.min(1 - top, placed.height));
            const identifying = !bottle && typeof tracked.identifying === 'number';
            const provisional = !bottle ? tracked.provisional : undefined;
            const readName = (read?: BottleRead) => read ? displayName(read.match?.brand || read.brand, read.match?.product || read.product) : '';
            const name = bottle ? readName(bottle) : identifying ? (readName(provisional) ? readName(provisional) + '?' : 'IDENTIFYING…') : 'BOTTLE DETECTED';
            // "Probably …" until the bottle is confirmed: the phone's quick guess, or the leading name from a
            // partly hidden label's clues (the camera surface decides when there is one).
            const guess = !bottle && tracked.probable ? tracked.probable : undefined;
            const boxStyle = {
              left: ((left * 100) + '%') as `${number}%`,
              top: ((top * 100) + '%') as `${number}%`,
              width: ((trackedWidth * 100) + '%') as `${number}%`,
              height: ((trackedHeight * 100) + '%') as `${number}%`,
            };
            const boxPx = trackedWidth * screenWidth;   // box width in points (stage text fits inside it)
            // Where this bottle is in the 1-2-3-4 steps; a box never goes back to an earlier step.
            // A name confirmed but not yet saved stays at step 3 (99%); once saved, a new bottle shows step 4
            // (researching) and a known bottle shows its name.
            const done = isDone(tracked);
            const current: ShownStage = bottle
              ? (tracked.stage?.name === 'researching' ? { stage: 'researching', since: tracked.stage.since }
                : done ? { stage: 'found' } : { stage: 'identifying', value: 0.99 })
              : tracked.stage?.name === 'reading' ? { stage: 'recognizing', since: tracked.stage.since }
              : identifying ? { stage: 'identifying', value: tracked.identifying }
              : tracked.stage?.name === 'zoom' ? { stage: 'zoom', value: tracked.stage.value }
              : { stage: 'scanning', value: tracked.confidence };
            const staged = forwardOnlyStage(stageMemoryRef.current.get(tracked.trackId), current, Date.now());
            stageMemoryRef.current.set(tracked.trackId, staged.memory);
            const shownStage = staged.shown;
            if (tracked.ask) {
              // Known maker, not sure which bottle: amber box the person taps to say which one it is.
              const seen = readName(provisional);
              return (
                <View key={tracked.trackId} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                  <Pressable accessibilityRole="button" accessibilityLabel={'Which bottle is this? ' + seen}
                    onPress={() => setAskingTrack({ trackId: tracked.trackId, seen, choices: tracked.ask!.choices })}
                    style={[s.liveDetectionBox, s.liveDetectionBoxAsk, boxStyle, BOX_GLIDE]}>
                    <View pointerEvents="none" style={s.askTag}><Text numberOfLines={1} style={s.askTagText}>{'WHICH ONE? TAP · ' + (seen.split(' ').slice(0, 3).join(' ') || '').toUpperCase()}</Text></View>
                  </Pressable>
                </View>
              );
            }
            // Three looks (Rob, 17 Nov 2026): thin white = still looking; amber dashed = "Probably …";
            // solid green with ✓ = done (named and saved). Boxes glide to their new place instead of jumping.
            if (bottle) {
              // Identified: its chip is in the strip at the top, so the box stays thin with a small tag.
              return (
                <View key={tracked.trackId} pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[s.liveDetectionBox, done ? s.liveDetectionBoxDone : s.liveDetectionBoxNamed, boxStyle, BOX_GLIDE]}>
                    <BoxStage stage={shownStage.stage} since={shownStage.since} value={shownStage.value} name={name} boxWidth={boxPx} />
                  </View>
                </View>
              );
            }
            // Boxes only show what the scanner sees; they are not tappable.
            // Identified bottles are opened from the found strip at the top.
            return (
              <View key={tracked.trackId} pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[s.liveDetectionBox, guess ? s.liveDetectionBoxGuess : s.liveDetectionBoxLooking, boxStyle, BOX_GLIDE]}>
                  {/* What the scanner is doing with this bottle right now, with its progress. */}
                  <BoxStage stage={shownStage.stage} since={shownStage.since} value={shownStage.value} name={name} guess={guess} boxWidth={boxPx} />
                </View>
              </View>
            );
          })}
        </View>
        </View>
      )}
      {permission.granted && !scanPhotos && <View pointerEvents="none" style={[s.cameraViewClip, { top: cameraViewTop, height: Math.max(0, cameraViewBottom - cameraViewTop) }]}><View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: -cameraViewTop, height: screenHeight }}><WorldBottleAnchorOverlay candidates={liveCandidates} currentDepthFrame={liveDepthFrame} observationFrame={liveSpatialObservationFrame} currentCameraPose={liveCameraPose} sessionKey={anchorSessionKey} visible={liveTracking.state !== 'paused' && liveTracking.state !== 'interrupted' && liveTracking.state !== 'not_available'} /></View></View>}
      {permission.granted && !scanPhotos && <FoundTray items={foundItems} hiddenKeys={foundKeysInFlight} unseenKeys={unseenFoundKeys} selectedKey={selectedFoundKey} top={foundTrayTop} onSelect={openFoundItem} onClear={() => { foundRef.current = []; setFoundItems([]); setFoundFlights([]); closeProfile(); }} />}
      {permission.granted && !scanPhotos && (foundItems.length > 0 || shownCandidates.length > 0) && (() => {
        const asking = shownCandidates.filter(track => !!track.ask).length;
        const working = shownCandidates.filter(track => !isDone(track) && !track.ask).length;
        return <View pointerEvents="none" style={[s.scanCount, { top: cameraViewTop + 4 }]}>
          <Text style={s.scanCountDone}>✓ {foundItems.length} DONE</Text>
          {asking > 0 && <Text style={s.scanCountAsk}>  ·  {asking} TO CONFIRM</Text>}
          {working > 0 && <Text style={s.scanCountWorking}>  ·  {working} READING</Text>}
        </View>;
      })()}
      {askingTrack && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setAskingTrack(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        <View style={[s.askSheet, { bottom: Math.max(insets.bottom, 8) + 76 }]}>
          <Text style={s.askTitle}>WHICH BOTTLE IS THIS?</Text>
          {!!askingTrack.seen && <Text style={s.askSeen}>The label reads like: {askingTrack.seen}</Text>}
          {askingTrack.choices.length === 0 && <Text style={s.askSeen}>Looking up choices…</Text>}
          {askingTrack.choices.map((choice, index) => (
            <Pressable key={index} accessibilityRole="button" onPress={() => answerAsk({ brand: choice.brand, product: choice.product })} style={s.askChoice}>
              <Text style={s.askChoiceText}>{displayName(choice.brand, choice.product)}</Text>
            </Pressable>
          ))}
          <View style={s.askTypeRow}>
            <TextInput value={typedName} onChangeText={setTypedName} placeholder="Something else? Type the name" placeholderTextColor={C.muted} style={s.askInput} returnKeyType="done"
              onSubmitEditing={() => typedName.trim() && answerAsk({ brand: typedName.trim(), product: '' })} />
            <Pressable accessibilityRole="button" disabled={!typedName.trim()} onPress={() => answerAsk({ brand: typedName.trim(), product: '' })} style={[s.askOk, !typedName.trim() && { opacity: 0.4 }]}><Text style={s.askOkText}>OK</Text></Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={() => answerAsk({ none: true })} style={s.askSkip}><Text style={s.askSkipText}>Not sure / skip this bottle</Text></Pressable>
        </View>
      </>}
      {foundFlights.map(flight => <FoundFlightLabel key={flight.id} flight={flight} onDone={done => setFoundFlights(flights => flights.filter(f => f.id !== done.id))} />)}
      {!!cameraMessage && <View style={[s.cameraMessage, { top: Math.max(insets.top, 24) + 75 }]}><Text style={s.cameraMessageText}>{cameraMessage}</Text></View>}
      <View style={[s.topBar, { top: Math.max(insets.top, Platform.OS === 'ios' ? 12 : 8) + 10 }]}>
        <View><Text style={s.wordmark}>HARMONY</Text><Text style={s.wordmarkSub}>D I S C O V E R</Text></View>
        <View style={s.topActions}><Pressable style={s.profileButton} onPress={() => setActivePanel('favorites')}><Ionicons name="person-outline" size={19} color={C.ivory} /></Pressable></View>
      </View>
      <View style={[s.centerHint, { top: Math.max(insets.top, 24) + 112, bottom: Math.max(insets.bottom, 12) + (screenHeight < 750 ? 218 : 238) }]} pointerEvents="none">
        <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} /><View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
        <Text style={s.centerHintText}>FIND THE DRINK WORTH TALKING ABOUT</Text>
      </View>
      <View onLayout={event => setBottomAreaTop(event.nativeEvent.layout.y)} style={[s.bottomArea, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 6) + (isLandscape ? 5 : 7), paddingTop: isLandscape ? 6 : 8, left: isLandscape ? 22 : 10, right: isLandscape ? 22 : 10 }]}>
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
      {venueCheckin.active && !venueCheckin.prompt && <View style={{position:'absolute',zIndex:30,top:insets.top+8,alignSelf:'center',flexDirection:'row',alignItems:'center',paddingHorizontal:11,paddingVertical:6,borderRadius:14,backgroundColor:'rgba(6,14,30,0.88)',borderWidth:1,borderColor:'rgba(255,209,102,0.7)'}}>
        <Text style={{color:'#FFD166',fontSize:10,fontWeight:'900'}}>AT {venueCheckin.active.venueName.toUpperCase().slice(0,26)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo check-in" onPress={()=>void venueCheckin.undo()} style={{marginLeft:9}}><Text style={{color:'#8DBBFF',fontSize:10,fontWeight:'900'}}>UNDO</Text></Pressable>
      </View>}
      {venueCheckin.prompt && <VenueCheckinPrompt state={venueCheckin.prompt} busy={venueCheckin.busy} error={venueCheckin.error} onConfirm={(venue,selection,share)=>void venueCheckin.confirm(venue,selection,share)} onDismiss={venueCheckin.dismiss}/>}
      {scanPhotos && <View style={{position:'absolute',zIndex:50,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><LiveScanner photos={scanPhotos} source={scanSource} mode={scanMode} onClose={()=>setScanPhotos(null)} onJourneyItems={setJourneyItems} onKeepMenu={()=>{setScanPhotos(null);setActivePanel('menu');}} /></View>}
      {activePanel === 'menu' && <View style={{position:'absolute',zIndex:40,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><PreviewPanel onClose={()=>setActivePanel(null)} onAddPages={addMenuPages} /></View>}
      {activePanel === 'inventory' && <View style={{position:'absolute',zIndex:40,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:Math.min(screenHeight*0.78,760),borderRadius:20,overflow:'hidden',borderWidth:1,borderColor:'rgba(198,163,106,0.55)',backgroundColor:C.bg}}><LiveInventoryPanel onClose={()=>setActivePanel(null)} tracking={liveTracking} depthStatus={liveDepthStatus} depthFrame={liveDepthFrame} liquidMetrics={liveLiquidMetrics} candidates={liveCandidates} bottles={liveBottles} barcodes={liveBarcodes} labelText={liveLabelText} menu={liveMenu} lastReadAt={liveReadAt} /></View>}
      {activePanel && activePanel !== 'inventory' && activePanel !== 'menu' && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Close panel" onPress={()=>setActivePanel(null)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:30,backgroundColor:activePanel==='lidar'?'rgba(0,0,0,0.08)':'rgba(0,0,0,0.42)'}} />
        <View style={{position:'absolute',zIndex:31,left:8,right:8,bottom:Math.max(insets.bottom,Platform.OS==='ios'?8:6)+76,height:activePanel==='lidar'?'46%':activePanel==='nearby'?'88%':undefined,maxHeight:activePanel==='lidar'?'50%':activePanel==='nearby'?'90%':'78%',padding:activePanel==='lidar'?10:activePanel==='nearby'?8:16,borderRadius:20,backgroundColor:'rgba(10,13,18,0.98)',borderWidth:1,borderColor:'rgba(198,163,106,0.48)'}}>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:activePanel==='nearby'?4:10}}>
            <Text style={{color:C.ivory,fontSize:activePanel==='nearby'?10:12,fontWeight:'900',letterSpacing:1.5}}>{({favorites:'FAVORITES',nearby:'NEARBY ATLAS',marty:'MARTY SULLIVAN',privacy:'PRIVACY & CONTRIBUTIONS',inventory:'LIVE INVENTORY SCANNER',lidar:'LIVE 3D / LIDAR SCANNER',collection:'MY COLLECTION',taste:'MY TASTE'} as const)[activePanel]}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close panel" onPress={()=>setActivePanel(null)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable>
          </View>
          {activePanel!=='lidar' && activePanel!=='nearby' && <Text style={{color:C.ivory,fontSize:14,fontWeight:'800',marginBottom:6}}>{activePanel==='favorites'?'Your saved discoveries':activePanel==='marty'?'Your beverage guide, on this camera screen':activePanel==='privacy'?'Your data and contribution choices':activePanel==='collection'?'Your saved beverage discoveries':'Your personal flavor profile'}</Text>}
          {activePanel==='lidar' ? <LidarScannerPanel onClose={()=>setActivePanel(null)} tracking={liveTracking} depthStatus={liveDepthStatus} depthFrame={liveDepthFrame} candidates={liveCandidates} bottles={liveBottles} /> : activePanel==='privacy' ? <PrivacyPanel/> : activePanel==='nearby' ? <NearbyPanel command={nearbyCommand} onCommandResult={handleNearbyCommandResult} journeyItems={journeyItems} onOpenJourney={setActiveJourney} checkedInVenueRef={venueCheckin.active?.venueRef ?? null}/> : activePanel==='marty' ? <MartyPanel onOpenSettings={()=>setMartyConsentOpen(true)} onNavigateCommand={handleMartyAppCommand}/> : <Text style={{color:C.muted,fontSize:11,lineHeight:17}}>{activePanel==='favorites'?'Your saved items will appear here. No saved discoveries are currently loaded.':activePanel==='collection'?'Your saved drinks, bottles, wines and Journeys will appear here. Collection sync is not enabled yet.':activePanel==='taste'?'Your optional flavor profile will develop from discoveries you choose to save. Taste profiling is not active yet.':'3D depth scanning depends on supported native device capabilities and is not available as a web-page route.'}</Text>}
          {activePanel==='marty' && martyConsentOpen && <>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Marty consent settings" onPress={()=>setMartyConsentOpen(false)} style={{position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:80,backgroundColor:'rgba(0,0,0,0.48)'}} />
            <View style={{position:'absolute',zIndex:81,left:0,right:0,bottom:0,maxHeight:'88%',padding:12,borderTopLeftRadius:18,borderTopRightRadius:18,backgroundColor:'rgba(10,13,18,0.995)',borderWidth:1,borderColor:'rgba(198,163,106,0.7)'}}>
              <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8}}><Text style={{color:C.ivory,fontSize:11,fontWeight:'900',letterSpacing:1.3}}>MARTY · VOICE & MEMORY CONSENT</Text><Pressable onPress={()=>setMartyConsentOpen(false)}><Ionicons name="close-circle-outline" size={22} color={C.muted}/></Pressable></View>
              <MartyConsentPanel />
            </View>
          </>}
        </View>
      </>}
      {selectedBottle && (() => {
        const cardBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 8 : 6) + 76;
        const cardHeight = Math.min(screenHeight * 0.62, 620);
        const from = selectedFrom ?? { x: screenWidth / 2, y: foundTrayTop };
        // Grows out of the tapped chip: start centred on the chip, small, then settle in place.
        const startX = from.x - screenWidth / 2;
        const startY = from.y - (screenHeight - cardBottom - cardHeight / 2);
        return (
        // zIndex here too: on the web every view starts its own layer, so without it the scan boxes drew over the card.
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 69 }]}>
          <Animated.View
            pointerEvents="box-none"
            style={{
              opacity: profileGrow.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.9, 1] }),
              transform: [
                { translateX: profileGrow.interpolate({ inputRange: [0, 1], outputRange: [startX, 0] }) },
                { translateY: profileGrow.interpolate({ inputRange: [0, 1], outputRange: [startY, 0] }) },
                { scale: profileGrow.interpolate({ inputRange: [0, 1], outputRange: [0.08, 1] }) },
              ],
              position:'absolute',
              zIndex:69,
              left:8,
              right:8,
              bottom:cardBottom,
              height:cardHeight,
              borderRadius:18,
              overflow:'hidden',
              borderWidth:1,
              borderColor:'rgba(198,163,106,0.58)',
              backgroundColor:'#0A0D12',
            }}
          >
            <BottleProfilePanel
              bottle={selectedBottle}
              intelligence={selectedBottleIntelligence}
              intelligenceLoading={selectedBottleIntelligenceLoading}
              onClose={closeProfile}
            />
          </Animated.View>
        </View>
        );
      })()}
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
          <Pressable style={s.menuRow} accessibilityRole="button" accessibilityLabel={liveReadConsent ? 'Pause live recognition' : 'Enable live recognition'} onPress={()=>setLiveReadConsent(value=>!value)}><Ionicons name="scan-outline" size={18} color={liveReadConsent?'#77E5B5':C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Live Recognition</Text><Text style={s.menuDesc}>Send cropped live frames to Discover and Anthropic for bottle and menu reading. Images are not saved. Bottles the scanner is sure of are saved as sightings to build the shared catalogue, and their missing facts are looked up on the web.</Text></View><Text style={[s.menuValue,{color:liveReadConsent?'#77E5B5':C.muted}]}>{liveReadConsent?'ON':'OFF'}</Text></Pressable>
          {!onPhone && <Pressable style={s.menuRow} accessibilityRole="button" accessibilityLabel={quickGuess ? 'Turn off quick guess' : 'Turn on quick guess'} onPress={()=>setQuickGuess(value=>!value)}><Ionicons name="flash-outline" size={18} color={quickGuess?'#77E5B5':C.brass}/><View style={{flex:1}}><Text style={s.menuTitle}>Quick Guess</Text><Text style={s.menuDesc}>{QUICK_GUESS_DESCRIPTION}</Text><Text style={s.menuDesc}>{QUICK_GUESS_DATA_NOTICE}</Text></View><Text style={[s.menuValue,{color:quickGuess?'#77E5B5':C.muted}]}>{quickGuess?'ON':'OFF'}</Text></Pressable>}
          </ScrollView>
        </View>
      </>}
    </View>
  );
}
const s = StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},menuRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:11,paddingVertical:7,borderBottomWidth:1,borderBottomColor:'rgba(153,163,174,0.12)'},menuTitle:{color:C.ivory,fontSize:11,fontWeight:'800'},menuDesc:{color:C.muted,fontSize:9,marginTop:3},menuValue:{color:C.brass,fontSize:8,fontWeight:'900',letterSpacing:1},cameraMessage:{position:'absolute',left:24,right:24,zIndex:20,padding:11,borderRadius:10,backgroundColor:'rgba(8,10,13,0.94)',borderWidth:1,borderColor:C.line},cameraMessageText:{color:C.ivory,fontSize:11,lineHeight:16,textAlign:'center'},loading:{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},loadingText:{color:C.brass,letterSpacing:5,fontWeight:'800'},
 permissionFallback:{backgroundColor:'#090B0F',alignItems:'center',justifyContent:'center'},permissionCard:{position:'absolute',left:28,right:28,top:'35%',padding:22,borderRadius:18,backgroundColor:'rgba(9,11,14,0.92)',borderWidth:1,borderColor:C.line},permissionTitle:{color:C.ivory,fontSize:23,fontWeight:'700',marginTop:12},permissionBody:{color:C.muted,fontSize:13,lineHeight:20,marginTop:7},permissionButton:{backgroundColor:C.brass,padding:14,borderRadius:10,alignItems:'center',marginTop:18},permissionButtonText:{color:'#111',fontSize:11,fontWeight:'900',letterSpacing:1.5},
 viewfinderShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(3,5,8,0.25)'},liveDetectionLayer:{...StyleSheet.absoluteFillObject,zIndex:5},cameraViewClip:{position:'absolute',left:0,right:0,overflow:'hidden',zIndex:5},liveDetectionBox:{position:'absolute',borderWidth:1.5,borderColor:'#77E5B5',borderRadius:8,backgroundColor:'rgba(54,190,135,0.035)'},liveDetectionLabel:{position:'absolute',left:2,top:2,paddingHorizontal:5,paddingVertical:2,borderRadius:5,backgroundColor:'rgba(5,15,16,0.92)',borderWidth:1,borderColor:'rgba(119,229,181,0.8)'},liveDetectionBoxFound:{backgroundColor:'transparent'},liveDetectionBoxLooking:{borderWidth:1,borderColor:'rgba(233,255,245,0.55)',backgroundColor:'transparent'},liveDetectionBoxGuess:{borderWidth:1.5,borderStyle:'dashed',borderColor:'#FFC857',backgroundColor:'rgba(255,200,87,0.04)'},liveDetectionBoxNamed:{borderWidth:1.5,borderStyle:'dashed',borderColor:'#77E5B5',backgroundColor:'transparent'},liveDetectionBoxAsk:{borderWidth:2,borderColor:'#FFB020',backgroundColor:'rgba(255,176,32,0.08)'},askTag:{position:'absolute',left:0,right:0,top:3,alignItems:'center'},askTagText:{color:'#FFD27A',fontSize:7,fontWeight:'900',letterSpacing:0.3,backgroundColor:'rgba(5,15,16,0.88)',paddingHorizontal:5,paddingVertical:1.5,borderRadius:4,overflow:'hidden'},scanCountAsk:{color:'#FFB020',fontSize:9,fontWeight:'900',letterSpacing:0.8},askSheet:{position:'absolute',zIndex:61,left:10,right:10,maxHeight:'70%',padding:14,borderRadius:18,backgroundColor:'rgba(10,13,18,0.98)',borderWidth:1,borderColor:'rgba(255,176,32,0.7)'},askTitle:{color:'#FFD27A',fontSize:12,fontWeight:'900',letterSpacing:1.4,marginBottom:4},askSeen:{color:C.muted,fontSize:11,marginBottom:8},askChoice:{paddingVertical:11,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:'rgba(240,241,242,0.22)',marginBottom:7},askChoiceText:{color:C.ivory,fontSize:14,fontWeight:'800'},askTypeRow:{flexDirection:'row',alignItems:'center',gap:8,marginTop:2},askInput:{flex:1,color:C.ivory,fontSize:13,paddingVertical:9,paddingHorizontal:11,borderRadius:12,borderWidth:1,borderColor:'rgba(240,241,242,0.22)'},askOk:{paddingVertical:9,paddingHorizontal:14,borderRadius:12,backgroundColor:'#3EF0A0'},askOkText:{color:'#05100A',fontWeight:'900',fontSize:12},askSkip:{alignSelf:'center',marginTop:10,padding:6},askSkipText:{color:C.muted,fontSize:12,fontWeight:'700'},liveDetectionBoxDone:{borderWidth:2.5,borderColor:'#3EF0A0',backgroundColor:'rgba(62,240,160,0.07)'},scanCount:{position:'absolute',zIndex:6,alignSelf:'center',flexDirection:'row',paddingHorizontal:9,paddingVertical:3,borderRadius:10,backgroundColor:'rgba(5,15,16,0.78)'},scanCountDone:{color:'#3EF0A0',fontSize:9,fontWeight:'900',letterSpacing:0.8},scanCountWorking:{color:'rgba(233,255,245,0.75)',fontSize:9,fontWeight:'800',letterSpacing:0.8},liveFoundTag:{position:'absolute',left:-1,top:-15,paddingHorizontal:5,paddingVertical:1,borderRadius:4,backgroundColor:'rgba(5,15,16,0.8)'},liveFoundTagText:{color:'#BFF5DD',fontSize:7,fontWeight:'800'},liveDetectionName:{color:'#E9FFF5',fontSize:7,fontWeight:'900',letterSpacing:0.3},liveDetectionConfidence:{color:'#77E5B5',fontSize:6,fontWeight:'800',marginTop:2,letterSpacing:0.7},topBar:{position:'absolute',top:Platform.OS==='ios'?62:34,left:22,right:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},wordmark:{color:C.ivory,fontSize:17,fontWeight:'900',letterSpacing:4},wordmarkSub:{color:C.brass,fontSize:8,fontWeight:'700',letterSpacing:2.5,marginTop:4},topActions:{flexDirection:'row',alignItems:'center',gap:9},livePill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:9,paddingVertical:7,borderRadius:14,backgroundColor:'rgba(8,10,13,0.7)',borderWidth:1,borderColor:'rgba(153,163,174,0.18)'},liveDot:{width:5,height:5,borderRadius:3,backgroundColor:'#B75D55'},liveText:{color:C.ivory,fontSize:9,fontWeight:'800',letterSpacing:1},profileButton:{width:34,height:34,borderRadius:17,backgroundColor:'rgba(8,10,13,0.7)',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},
 centerHint:{position:'absolute',left:26,right:26,justifyContent:'center',alignItems:'center'},centerHintText:{color:'rgba(240,241,242,0.68)',fontSize:9,letterSpacing:2.4,fontWeight:'700'},corner:{position:'absolute',width:25,height:25,borderColor:'rgba(198,163,106,0.8)'},tl:{top:0,left:0,borderTopWidth:1,borderLeftWidth:1},tr:{top:0,right:0,borderTopWidth:1,borderRightWidth:1},bl:{bottom:0,left:0,borderBottomWidth:1,borderLeftWidth:1},br:{bottom:0,right:0,borderBottomWidth:1,borderRightWidth:1},
 bottomArea:{position:'absolute',bottom:0,backgroundColor:'rgba(7,9,12,0.92)',borderTopWidth:1,borderColor:C.line,borderTopLeftRadius:20,borderTopRightRadius:20,paddingHorizontal:8},controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4},utilityControl:{alignItems:'center',justifyContent:'center',gap:5,minWidth:42,paddingVertical:7},utilityLabel:{color:C.ivory,fontSize:7,fontWeight:'800',letterSpacing:0.7},centerControls:{flexDirection:'row',alignItems:'center',gap:8},primaryControl:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(20,24,30,0.9)'},primaryControlHalf:{width:30,height:30},primaryControlActive:{borderColor:C.brass},shutterOuter:{width:66,height:66,borderRadius:33,borderWidth:2,borderColor:C.ivory,alignItems:'center',justifyContent:'center'},shutterOuterCompact:{width:58,height:58},shutterInner:{width:52,height:52,borderRadius:26,backgroundColor:C.ivory},shutterInnerCompact:{width:44,height:44},shutterBusy:{opacity:0.55},shutterBusyText:{color:'#111',textAlign:'center',fontSize:20,fontWeight:'900',lineHeight:50}
});
