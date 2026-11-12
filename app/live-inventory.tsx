import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DiscoverARSurface, type ARKitDepthFrame, type ARTrackingUpdate } from '../src/live/DiscoverARSurface';
import type { BottleRead, LiveRead } from '../src/services/discoverLiveApi';

const C={bg:'#090D12',panel:'#111821',line:'rgba(198,163,106,0.24)',gold:'#C6A36A',white:'#F0F1F2',muted:'#929AA5',green:'#7DFFB5',amber:'#FFD27A'};
type Recognition = {
  text: string[];
  barcodes: Array<{value:string;symbology:string}>;
  classifications: Array<{identifier:string;confidence:string}>;
  frameTimestamp: number;
  bottles?: BottleRead[];
  menu?: LiveRead['menu'];
  diagnostics?: LiveRead['diagnostics'];
  barcodeStatus?: 'available'|'unsupported';
};

export function LiveInventoryPanel({onClose}:{onClose?:()=>void}={}) {
  const [active,setActive]=useState(false);
  const [tracking,setTracking]=useState<ARTrackingUpdate>({state:'paused',reason:'not_started'});
  const [recognition,setRecognition]=useState<Recognition|null>(null);
  const [depthStatus,setDepthStatus]=useState('Depth has not started.');
  const [depth,setDepth]=useState<{kind:'metric'|'relative';width:number;height:number;detail:string}|null>(null);
  const [candidateCount,setCandidateCount]=useState(0);
  const [error,setError]=useState('');

  const start=()=>{
    setError('');
    setRecognition(null);
    setDepth(null);
    setDepthStatus('Waiting for camera and depth capability…');
    setCandidateCount(0);
    setActive(true);
  };
  const stop=()=>{
    setActive(false);
    setTracking({state:'paused',reason:'user_paused'});
    setDepthStatus('Scanner paused.');
  };
  const statusColor=tracking.state==='normal'?C.green:tracking.state==='not_available'? '#F0A39B':C.amber;
  const bottles=recognition?.bottles||[];

  return <View style={s.root}>
    <View style={s.header}>
      <View style={s.grabber}/>
      <View style={s.headerRow}>
        <View style={{flex:1}}>
          <Text style={s.kicker}>HARMONY DISCOVER · LIVE INVENTORY</Text>
          <Text style={s.title}>Live bottle scanner</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close inventory panel" onPress={()=>{stop();onClose?.();}} style={s.close}><Text style={s.closeText}>×</Text></Pressable>
      </View>
      <View style={s.status}>
        <View style={[s.dot,{backgroundColor:statusColor}]}/>
        <View style={{flex:1}}>
          <Text style={[s.statusTitle,{color:statusColor}]}>{active?'CAMERA · '+tracking.state.toUpperCase().replace('_',' '):'SCANNER PAUSED'}</Text>
          <Text style={s.statusBody}>{active?tracking.reason.replace(/_/g,' '):'Start the camera when you are ready. Recognition runs only while this panel is active.'}</Text>
        </View>
      </View>
    </View>

    <View style={s.cameraFrame}>
      <DiscoverARSurface
        style={StyleSheet.absoluteFill}
        active={active}
        onTrackingUpdate={event=>setTracking(event.nativeEvent)}
        onARReady={()=>setError('')}
        onARError={event=>setError(event.nativeEvent.message||'Camera or AR session failed.')}
        onRecognitionUpdate={event=>setRecognition(event.nativeEvent)}
        onVisualCandidates={event=>setCandidateCount(event.nativeEvent.count)}
        onDepthStatus={event=>setDepthStatus(event.nativeEvent.status)}
        onDepthEstimate={event=>{
          const value=event.nativeEvent;
          if('unit' in value && value.unit==='meters'){
            const frame=value as ARKitDepthFrame;
            setDepth({kind:'metric',width:frame.width,height:frame.height,detail:'ARKit scene depth · metres'});
          }else{
            setDepth({kind:'relative',width:value.width,height:value.height,detail:'Relative monocular depth · not metres'});
          }
        }}
      />
      {!active&&<View pointerEvents="none" style={s.cameraPaused}><Text style={s.cameraPausedTitle}>VIEWFINDER STANDBY</Text><Text style={s.cameraPausedBody}>Start scanner to activate camera, recognition and supported depth signals.</Text></View>}
      {active&&<View pointerEvents="none" style={s.cameraBadge}><View style={s.liveDot}/><Text style={s.cameraBadgeText}>LIVE CAMERA</Text></View>}
    </View>

    {!!error&&<Text style={s.error}>{error}</Text>}

    <View style={s.controls}>
      <Pressable accessibilityRole="button" onPress={active?stop:start} style={[s.primaryButton,active&&s.pauseButton]}>
        <Text style={[s.primaryButtonText,active&&{color:C.white}]}>{active?'PAUSE SCANNER':'START LIVE SCANNER'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={()=>{stop();onClose?.();}} style={s.secondaryButton}><Text style={s.secondaryText}>CLOSE</Text></Pressable>
    </View>

    <ScrollView style={s.results} contentContainerStyle={s.resultsContent} showsVerticalScrollIndicator={false}>
      <Text style={s.section}>LIVE RECOGNITION</Text>
      <Text style={s.explainer}>{Platform.OS==='web'?'Browser camera · cloud label recognition about every 2.5 seconds · barcode detection when supported.':'Native camera · on-device OCR and barcode detection · ARKit depth when supported. Use the photo scanner for cloud bottle identification.'}</Text>
      <View style={s.metrics}>
        <View style={s.metric}><Text style={s.metricValue}>{bottles.length}</Text><Text style={s.metricLabel}>BOTTLES</Text></View>
        <View style={s.metric}><Text style={s.metricValue}>{recognition?.barcodes.length||0}</Text><Text style={s.metricLabel}>BARCODES</Text></View>
        <View style={s.metric}><Text style={s.metricValue}>{candidateCount}</Text><Text style={s.metricLabel}>TEMPORARY TRACKS</Text></View>
      </View>

      {bottles.length>0?bottles.map((b,index)=><View key={index} style={s.resultCard}>
        <Text style={s.resultName}>{[b.brand,b.product].filter(Boolean).join(' ')||'Unidentified bottle'}</Text>
        <Text style={s.resultMeta}>{[b.category,b.proof,b.size].filter(Boolean).join(' · ')||'Label detected'}</Text>
        <Text style={s.resultConfidence}>LABEL CONFIDENCE · {Math.round((b.confidence||0)*100)}%</Text>
        {b.state==='matched'&&<Text style={s.matched}>CATALOG MATCH · {b.match?.score??'—'}</Text>}
      </View>):<Text style={s.empty}>{active?'No bottle result in the latest frame yet. Hold the label steady and move closer.':'No live results yet.'}</Text>}

      {(recognition?.barcodes||[]).map((barcode,index)=><View key={barcode.value+index} style={s.barcodeRow}>
        <Text style={s.barcodeValue}>{barcode.value}</Text><Text style={s.barcodeType}>{barcode.symbology.toUpperCase()}</Text>
      </View>)}
      {recognition?.text?.length? <View style={s.ocrBox}><Text style={s.subsection}>VISIBLE TEXT</Text><Text style={s.ocrText}>{recognition.text.slice(0,12).join(' · ')}</Text></View>:null}

      <Text style={s.section}>DEPTH & SPATIAL SIGNALS</Text>
      <View style={s.depthCard}>
        <Text style={s.depthTitle}>{depth?.kind==='metric'?'METRIC DEPTH AVAILABLE':depth?.kind==='relative'?'RELATIVE DEPTH AVAILABLE':'DEPTH NOT VERIFIED'}</Text>
        <Text style={s.depthDetail}>{depth?depth.detail:depthStatus}</Text>
        {depth&&<Text style={s.depthDetail}>{depth.width} × {depth.height} depth samples</Text>}
        <Text style={s.depthCaution}>{depth?.kind==='relative'?'Relative depth cannot be used for physical measurements or world-space bottle reconstruction.':depth?.kind==='metric'?'Metric depth is available, but bottle detections are not yet anchored to world coordinates.':'Depth availability depends on device hardware and browser support.'}</Text>
      </View>
      {recognition?.diagnostics&&<Text style={s.diagnostics}>MODEL {recognition.diagnostics.model} · {recognition.diagnostics.providerMs} MS · API {recognition.diagnostics.version}</Text>}
      <View style={s.footer}><Text style={s.footerText}>DISCOVER DEV · LIVE RESULTS ARE NOT SAVED AUTOMATICALLY</Text></View>
    </ScrollView>
  </View>;
}
export default function LiveInventory(){return <LiveInventoryPanel/>;}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg,borderTopLeftRadius:20,borderTopRightRadius:20,overflow:'hidden'},
 header:{paddingHorizontal:18,paddingTop:9,paddingBottom:12,borderBottomWidth:1,borderColor:C.line},
 grabber:{alignSelf:'center',width:38,height:4,borderRadius:3,backgroundColor:'#68717C',marginBottom:12},
 headerRow:{flexDirection:'row',alignItems:'center',gap:12},
 kicker:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1.5},
 title:{color:C.white,fontSize:21,fontWeight:'800',marginTop:4},
 close:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:'#1A222D',borderWidth:1,borderColor:C.line},
 closeText:{color:C.white,fontSize:24,lineHeight:27,fontWeight:'300'},
 status:{flexDirection:'row',alignItems:'center',gap:10,marginTop:12,padding:10,borderRadius:11,backgroundColor:'#111B19',borderWidth:1,borderColor:'rgba(125,255,181,0.2)'},
 dot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},
 statusTitle:{fontSize:9,fontWeight:'900',letterSpacing:1},
 statusBody:{color:C.muted,fontSize:9,marginTop:3,lineHeight:13},
 cameraFrame:{height:230,minHeight:180,margin:12,borderRadius:12,overflow:'hidden',backgroundColor:'#030609',borderWidth:1,borderColor:'rgba(79,139,255,0.45)'},
 cameraPaused:{...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center',padding:24,backgroundColor:'rgba(3,6,9,0.82)'},
 cameraPausedTitle:{color:C.white,fontSize:11,fontWeight:'900',letterSpacing:1.4},
 cameraPausedBody:{color:C.muted,fontSize:10,lineHeight:15,textAlign:'center',marginTop:8},
 cameraBadge:{position:'absolute',top:10,left:10,flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:9,paddingVertical:6,borderRadius:20,backgroundColor:'rgba(3,6,9,0.78)'},
 liveDot:{width:6,height:6,borderRadius:3,backgroundColor:'#FF625B'},
 cameraBadgeText:{color:C.white,fontSize:8,fontWeight:'900',letterSpacing:1},
 error:{color:'#F0A39B',fontSize:10,textAlign:'center',paddingHorizontal:16},
 controls:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:10,paddingHorizontal:12,marginBottom:8},
 primaryButton:{minWidth:190,paddingVertical:12,paddingHorizontal:18,borderRadius:9,backgroundColor:C.gold,alignItems:'center'},
 pauseButton:{backgroundColor:'#273343',borderWidth:1,borderColor:C.line},
 primaryButtonText:{color:'#101317',fontSize:10,fontWeight:'900',letterSpacing:1},
 secondaryButton:{paddingVertical:12,paddingHorizontal:16,borderRadius:9,borderWidth:1,borderColor:'rgba(255,255,255,0.24)'},
 secondaryText:{color:C.white,fontSize:10,fontWeight:'800'},
 results:{flex:1,borderTopWidth:1,borderTopColor:C.line},
 resultsContent:{paddingHorizontal:16,paddingTop:12,paddingBottom:24},
 section:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1.5,marginBottom:7,marginTop:4},
 explainer:{color:C.muted,fontSize:9,lineHeight:14,marginBottom:10},
 metrics:{flexDirection:'row',gap:8,marginBottom:10},
 metric:{flex:1,padding:9,borderRadius:8,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,alignItems:'center'},
 metricValue:{color:C.white,fontSize:18,fontWeight:'900'},
 metricLabel:{color:C.muted,fontSize:7,fontWeight:'900',letterSpacing:1,marginTop:3},
 resultCard:{padding:11,borderRadius:9,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,marginBottom:8},
 resultName:{color:C.white,fontSize:12,fontWeight:'800'},
 resultMeta:{color:C.muted,fontSize:9,marginTop:4},
 resultConfidence:{color:C.gold,fontSize:8,fontWeight:'900',marginTop:7},
 matched:{color:C.green,fontSize:8,fontWeight:'900',marginTop:5},
 empty:{color:C.amber,fontSize:9,lineHeight:14,marginBottom:12},
 barcodeRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:8,borderBottomWidth:1,borderColor:C.line},
 barcodeValue:{color:C.white,fontSize:10,fontWeight:'800'},
 barcodeType:{color:C.gold,fontSize:8,fontWeight:'900'},
 ocrBox:{padding:10,borderRadius:8,backgroundColor:C.panel,marginTop:8,marginBottom:12},
 subsection:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1,marginBottom:5},
 ocrText:{color:C.white,fontSize:9,lineHeight:15},
 depthCard:{padding:11,borderRadius:9,backgroundColor:C.panel,borderWidth:1,borderColor:C.line},
 depthTitle:{color:C.white,fontSize:9,fontWeight:'900',letterSpacing:0.7},
 depthDetail:{color:C.muted,fontSize:9,marginTop:5},
 depthCaution:{color:C.amber,fontSize:8,lineHeight:13,marginTop:7},
 diagnostics:{color:C.muted,fontSize:8,marginTop:10},
 footer:{paddingVertical:16,alignItems:'center'},
 footerText:{color:'#68717C',fontSize:7,fontWeight:'800',letterSpacing:1},
});
