import { useState } from 'react';
import type { BottleRead, MenuGlimpse } from '../src/services/discoverLiveApi';
import type { ARTrackingUpdate, ARKitDepthFrame } from '../src/live/DiscoverARSurface';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createBottleVolumeProfile } from '../src/services/bottleVolumeCalibration';
import { getBottleCalibrationKey, parseBottleCalibrationSamples, saveBottleVolumeProfileForIdentity } from '../src/services/bottleVolumeProfileStore';

const C={bg:'#090D12',panel:'#111821',line:'rgba(198,163,106,0.24)',gold:'#C6A36A',white:'#F0F1F2',muted:'#929AA5',green:'#7DFFB5',amber:'#FFD27A'};
const GROUPS=[
  ['identity','Brand & producer','Brand, producer, distillery or winery'],
  ['sku','Product & SKU','Expression, vintage, batch, package size and barcode'],
  ['category','Category','Spirit, wine, beer, non-alcoholic and style'],
  ['composition','Composition','Mash bill, grape varieties, agave and botanicals'],
  ['oak','Oak & maturation','Cask type, origin, char, finish and age'],
  ['origin','Origin & provenance','Country, region, appellation and producer'],
  ['terroir','Terroir','Soil, climate, elevation and growing conditions'],
  ['production','Production','Fermentation, distillation and blending'],
  ['sensory','Tasting profile','Aroma, palate, texture and finish'],
  ['technical','Technical details','ABV, proof, certifications and batch'],
  ['sources','Research & confidence','Source links, verification and conflicts'],
] as const;

type LiveInventoryProps = { liquidMetrics?: {jobsDispatched:number;jobsCompleted:number;framesSkipped:number;workerErrors:number;lastWorkerMs:number;maxWorkerMs:number;segmentationMs:number;workerAvailable:boolean}; onClose?: () => void; tracking?: ARTrackingUpdate; depthStatus?: string; depthFrame?: ARKitDepthFrame | null; candidates?: Array<{trackId:number;x:number;y:number;width:number;height:number;confidence:number;bottle?:BottleRead;liquidLevel?:{heightPercent:number;confidence:number;method:'temporal_consensus';calibratedVolume?:{milliliters:number;fluidOunces:number;profileId:string}}}>; bottles?: BottleRead[]; barcodes?: Array<{value:string;symbology:string}>; labelText?: string[]; menu?: MenuGlimpse | null; lastReadAt?: number | null };


function BottleCalibrationEditor({bottle}:{bottle:BottleRead}) {
  const identityKey = getBottleCalibrationKey(bottle.match, bottle.state, bottle.size);
  const [capacity,setCapacity] = useState('');
  const [samples,setSamples] = useState('');
  const [status,setStatus] = useState('');
  const [saving,setSaving] = useState(false);
  if (!identityKey) return null;
  const save = async () => {
    const capacityMl = Number(capacity);
    if (!Number.isFinite(capacityMl) || capacityMl <= 0) { setStatus('Enter the bottle capacity in milliliters.'); return; }
    try {
      const parsed = parseBottleCalibrationSamples(samples);
      const built = createBottleVolumeProfile(identityKey, capacityMl, parsed);
      if (built.status !== 'created') { setStatus(built.reason.replace(/_/g,' ')); return; }
      setSaving(true);
      await saveBottleVolumeProfileForIdentity(identityKey,built.profile);
      setStatus('Calibration saved for this verified product.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Calibration could not be saved.');
    } finally { setSaving(false); }
  };
  return <View style={s.calibration}>
    <Text style={s.calibrationTitle}>BOTTLE-SHAPE CALIBRATION</Text>
    <Text style={s.calibrationHint}>Verified product match · calibration is stored on this device and applies only to this product.</Text>
    <TextInput value={capacity} onChangeText={setCapacity} keyboardType="decimal-pad" placeholder="Rated capacity (ml), e.g. 750" placeholderTextColor="#78818C" style={s.calibrationInput}/>
    <TextInput value={samples} onChangeText={setSamples} placeholder="height:ml pairs — 0:0, 0.5:350, 0.82:750" placeholderTextColor="#78818C" style={s.calibrationInput}/>
    <Text style={s.calibrationHint}>For each known measured volume, enter the live FILL HEIGHT as a fraction (52% = 0.52). Include empty 0:0 and the actual full-capacity fill line, which may be below 1. Do not guess samples.</Text>
    <Pressable disabled={saving} onPress={save} style={s.calibrationButton}><Text style={s.calibrationButtonText}>{saving?'SAVING…':'SAVE BOTTLE CALIBRATION'}</Text></Pressable>
    {!!status && <Text style={s.calibrationStatus}>{status}</Text>}
  </View>;
}

export function LiveInventoryPanel({onClose,tracking,depthStatus='waiting_for_depth_provider',depthFrame,liquidMetrics,candidates=[],bottles=[],barcodes=[],labelText=[],menu,lastReadAt}:LiveInventoryProps={}) {
  const [expanded,setExpanded]=useState<string[]>(['identity','sku']);
  const toggle=(id:string)=>setExpanded(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
  const metricDepthSamples=depthFrame?.depthMeters.filter(value=>Number.isFinite(value)&&value>0).length ?? 0;
  return <View style={s.root}>
    <View style={s.header}>
      <View style={s.grabber}/>
      <View style={s.headerRow}>
        <View style={{flex:1}}>
          <Text style={s.kicker}>HARMONY DISCOVER · LIVE INVENTORY</Text>
          <Text style={s.title}>Inventory intelligence</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close inventory panel" onPress={onClose} style={s.close}><Text style={s.closeText}>×</Text></Pressable>
      </View>
      <View style={s.status}>
        <View style={[s.dot,{backgroundColor:tracking?.state==='normal'?C.green:C.amber}]}/>
        <View style={{flex:1}}>
          <Text style={s.statusTitle}>SHARED CAMERA · {tracking?.state?.toUpperCase().replace('_',' ') || 'STARTING'}</Text>
          <Text style={s.statusBody}>{bottles.length} bottle reads · {candidates.length} tracked candidates · {depthStatus.replace(/_/g,' ')}{depthFrame ? ` · ${metricDepthSamples} metric depth samples` : ''}</Text>
          <Text style={s.statusBody}>LIQUID WORKER · {liquidMetrics?.workerAvailable?'AVAILABLE':'UNAVAILABLE'} · {liquidMetrics?.jobsCompleted ?? 0} jobs · {Math.round(liquidMetrics?.lastWorkerMs ?? 0)} ms worker · {Math.round(liquidMetrics?.segmentationMs ?? 0)} ms segmentation · {liquidMetrics?.framesSkipped ?? 0} skipped · {liquidMetrics?.workerErrors ?? 0} errors</Text>
        </View>
      </View>
      <Text style={s.note}>This panel reads the same camera session used by the main viewfinder. It never starts another camera. {lastReadAt ? `Last recognition: ${new Date(lastReadAt).toLocaleTimeString()}.` : 'Waiting for the first recognition result.'}</Text>
    </View>
    <ScrollView style={s.scroll} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
      <Text style={s.section}>LIVE INVENTORY FEED · {candidates.length || bottles.length}</Text>
      {candidates.length ? candidates.map((candidate,index)=>{
        const bottle=(candidate as typeof candidate & {trackId?:number;bottle?:BottleRead}).bottle;
        const confidence=Math.round(candidate.confidence*100);
        const fillLabel=candidate.liquidLevel ? ` · FILL HEIGHT ~${candidate.liquidLevel.heightPercent}%` : ''; 
        return <View key={String((candidate as typeof candidate & {trackId?:number}).trackId ?? index)} style={s.group}>
          <View style={s.groupButton}><View style={{flex:1}}>
            <Text style={s.groupTitle}>{bottle ? [bottle.match?.brand||bottle.brand,bottle.product].filter(Boolean).join(' ')||'Bottle detected' : 'Bottle detected · reading label'}</Text>
            <Text style={s.groupHint}>{bottle ? bottle.category.toUpperCase()+' · '+Math.round(bottle.confidence*100)+'% ID CONFIDENCE · '+bottle.state.toUpperCase()+fillLabel : 'PROVISIONAL · '+confidence+'% DETECTION CONFIDENCE · IDENTITY PENDING'+fillLabel}</Text>
          </View></View>
          <View style={s.groupBody}><Text style={s.emptyHint}>{bottle ? [bottle.proof,bottle.size,bottle.origin,...bottle.words].filter(Boolean).join(' · ')||'Bottle detected; additional label facts are still being read.' : 'Spatial track is live. Brand, product and package details will populate when AI recognition returns.'}{candidate.liquidLevel ? ` Visual fill-height estimate · ${Math.round(candidate.liquidLevel.confidence*100)}% signal confidence.` : ''}{candidate.liquidLevel?.calibratedVolume ? ` Calibrated volume: ${Math.round(candidate.liquidLevel.calibratedVolume.milliliters)} ml / ${candidate.liquidLevel.calibratedVolume.fluidOunces.toFixed(1)} fl oz.` : candidate.liquidLevel ? ' No bottle-specific volume calibration is saved yet.' : ''}</Text>{bottle && <BottleCalibrationEditor bottle={bottle}/>}</View>
        </View>;
      }) : bottles.length ? bottles.map((bottle,index)=><View key={`read-${index}-${bottle.box.x0}-${bottle.box.y0}`} style={s.group}><View style={s.groupButton}><View style={{flex:1}}><Text style={s.groupTitle}>{[bottle.brand,bottle.product].filter(Boolean).join(' ') || 'Unidentified beverage'}</Text><Text style={s.groupHint}>{bottle.category.toUpperCase()} · {Math.round(bottle.confidence*100)}% confidence · {bottle.state.toUpperCase()}</Text></View></View><View style={s.groupBody}><Text style={s.emptyHint}>{[bottle.proof,bottle.size,bottle.origin,...bottle.words].filter(Boolean).join(' · ') || 'No additional label facts returned yet.'}</Text></View></View>) : <Text style={s.emptyHint}>Point the camera at bottles. A provisional inventory row appears as soon as local detection stabilizes; product identity fills in when the AI label read completes.</Text>}
      <Text style={s.section}>LIVE LABEL SIGNALS · {barcodes.length} BARCODES · {labelText.length} TEXT READS</Text>
      {barcodes.length ? barcodes.map((barcode,index)=><View key={barcode.value+'-'+index} style={s.group}><View style={s.groupBody}><Text style={s.groupTitle}>{barcode.value}</Text><Text style={s.groupHint}>BARCODE · {barcode.symbology.toUpperCase()}</Text></View></View>) : <Text style={s.emptyHint}>No barcode decoded in the latest camera frames.</Text>}
      {labelText.length>0 && <View style={s.group}><View style={s.groupBody}><Text style={s.groupTitle}>OCR TEXT</Text><Text style={s.emptyHint}>{labelText.slice(0,18).join(' · ')}</Text></View></View>}
      <Text style={s.section}>PRODUCT PROFILE</Text>
      {GROUPS.map(([id,title,hint])=><View key={id} style={s.group}>
        <Pressable accessibilityRole="button" accessibilityState={{expanded:expanded.includes(id)}} onPress={()=>toggle(id)} style={s.groupButton}>
          <View style={{flex:1}}>
            <Text style={s.groupTitle}>{title}</Text>
            <Text style={s.groupHint}>{hint}</Text>
          </View>
          <Text style={s.chevron}>{expanded.includes(id)?'−':'+'}</Text>
        </Pressable>
        {expanded.includes(id)&&<View style={s.groupBody}><Text style={s.empty}>No verified data yet</Text><Text style={s.emptyHint}>This section fills after a product is identified and its details are verified.</Text></View>}
      </View>)}
      <View style={s.footer}><Text style={s.footerText}>DISCOVER DEV · NO UNVERIFIED PRODUCT FACTS DISPLAYED</Text></View>
    </ScrollView>
  </View>;
}
export default function LiveInventory(){return <LiveInventoryPanel/>;}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg,borderTopLeftRadius:20,borderTopRightRadius:20,overflow:'hidden'},
 header:{paddingHorizontal:18,paddingTop:9,paddingBottom:14,borderBottomWidth:1,borderColor:C.line},
 grabber:{alignSelf:'center',width:38,height:4,borderRadius:3,backgroundColor:'#68717C',marginBottom:12},
 headerRow:{flexDirection:'row',alignItems:'center',gap:12},
 kicker:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1.5},
 title:{color:C.white,fontSize:21,fontWeight:'800',marginTop:4},
 close:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:'#1A222D',borderWidth:1,borderColor:C.line},
 closeText:{color:C.white,fontSize:24,lineHeight:27,fontWeight:'300'},
 status:{flexDirection:'row',alignItems:'center',gap:10,marginTop:13,padding:11,borderRadius:11,backgroundColor:'#111B19',borderWidth:1,borderColor:'rgba(125,255,181,0.2)'},
 dot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},
 statusTitle:{color:C.green,fontSize:9,fontWeight:'900',letterSpacing:1},
 statusBody:{color:C.muted,fontSize:10,marginTop:3,lineHeight:14},
 note:{color:C.muted,fontSize:9,lineHeight:14,marginTop:10},
 scroll:{flex:1},list:{paddingHorizontal:16,paddingTop:14,paddingBottom:24},
 section:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1.5,marginBottom:7},
 group:{borderBottomWidth:1,borderColor:'rgba(198,163,106,0.13)'},
 groupButton:{minHeight:54,paddingVertical:9,flexDirection:'row',alignItems:'center',gap:10},
 groupTitle:{color:C.white,fontSize:12,fontWeight:'700'},
 groupHint:{color:C.muted,fontSize:9,marginTop:3},
 chevron:{color:C.gold,fontSize:22,width:24,textAlign:'center'},
 groupBody:{paddingBottom:12,paddingRight:24},
 calibration:{marginTop:10,padding:10,borderRadius:9,borderWidth:1,borderColor:'rgba(198,163,106,0.22)',backgroundColor:'#0C1219'},
 calibrationTitle:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1},
 calibrationHint:{color:C.muted,fontSize:8,lineHeight:12,marginTop:5},
 calibrationInput:{marginTop:7,minHeight:36,paddingHorizontal:9,paddingVertical:7,borderRadius:7,borderWidth:1,borderColor:'rgba(198,163,106,0.25)',color:C.white,fontSize:10},
 calibrationButton:{marginTop:8,padding:9,borderRadius:7,backgroundColor:'#C6A36A',alignItems:'center'},
 calibrationButtonText:{color:'#111821',fontSize:8,fontWeight:'900',letterSpacing:0.8},
 calibrationStatus:{color:C.amber,fontSize:8,marginTop:6},
 empty:{color:C.amber,fontSize:10,fontWeight:'800'},
 emptyHint:{color:C.muted,fontSize:9,lineHeight:14,marginTop:4},
 footer:{paddingVertical:18,alignItems:'center'},
 footerText:{color:'#68717C',fontSize:7,fontWeight:'800',letterSpacing:1},
});
