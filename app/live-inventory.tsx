import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { DiscoverARSurface, type ARTrackingUpdate } from '../src/live/DiscoverARSurface';

const C={bg:'#07090C',panel:'#0B1017',line:'rgba(198,163,106,0.28)',gold:'#C6A36A',white:'#F0F1F2',muted:'#929AA5',green:'#7DFFB5',amber:'#FFD27A'};
const GROUPS=[
 {id:'identity',title:'Brand & producer',hint:'Brand, producer, distillery or winery'},
 {id:'sku',title:'Product & specific SKU',hint:'Expression, bottling, vintage, package size, barcode'},
 {id:'category',title:'Category & classification',hint:'Spirit, wine, beer, NA; style and legal class'},
 {id:'composition',title:'Mash bill & composition',hint:'Grain bill, grape varieties, agave, botanicals'},
 {id:'oak',title:'Oak & maturation',hint:'Oak species, origin, char, cask type, finish, aging'},
 {id:'origin',title:'Origin & provenance',hint:'Country, region, appellation, distillery or vineyard'},
 {id:'terroir',title:'Terroir & growing conditions',hint:'Soil, climate, elevation, exposure, water'},
 {id:'production',title:'Production method',hint:'Fermentation, distillation, cooperage, blending'},
 {id:'history',title:'History & story',hint:'Founding, ownership, heritage, producer history'},
 {id:'sensory',title:'Tasting & sensory profile',hint:'Aroma, palate, texture, finish, verified notes'},
 {id:'technical',title:'Technical specifications',hint:'ABV, proof, age statement, batch, certifications'},
 {id:'sources',title:'Research sources & confidence',hint:'Source links, verification, conflicts, last checked'},
];
export default function LiveInventory(){
 const {width,height}=useWindowDimensions();
 const wide=width>=760;
 const [permission,requestPermission]=useCameraPermissions();
 const [active,setActive]=useState(false);
 const [tracking,setTracking]=useState<ARTrackingUpdate>({state:'paused',reason:'not_started'});
 const [error,setError]=useState('');
 const [expanded,setExpanded]=useState<string[]>(['identity','sku']);
 const pulse=useRef(new Animated.Value(.35)).current;
 const sweep=useRef(new Animated.Value(0)).current;
 useEffect(()=>{const a=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:1,duration:950,useNativeDriver:true}),Animated.timing(pulse,{toValue:.35,duration:950,useNativeDriver:true})]));a.start();return()=>a.stop();},[pulse]);
 useEffect(()=>{if(!active)return;const a=Animated.loop(Animated.timing(sweep,{toValue:1,duration:2600,useNativeDriver:true}));a.start();return()=>a.stop();},[active,sweep]);
 const start=async()=>{setError('');if(!permission?.granted){const p=await requestPermission();if(!p.granted){setError('Camera permission is required.');return;}}setActive(true);};
 const scanlineY=sweep.interpolate({inputRange:[0,1],outputRange:[0,wide?height:330]});
 const toggle=(id:string)=>setExpanded(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
 const infoPanel=<View style={[s.infoPanel,wide?s.wideInfo:null]}>
  <View style={s.infoHeader}>
   <Text style={s.eyebrow}>PRODUCT INTELLIGENCE</Text>
   <Text style={s.infoTitle}>Bottle profile</Text>
   <Text style={s.infoSub}>Research is not connected to this live scan yet. No product facts are being invented or presented as verified.</Text>
   <View style={s.statusRow}><View style={s.statusDot}/><Text style={s.statusText}>AWAITING BOTTLE IDENTIFICATION</Text></View>
  </View>
  <ScrollView style={s.groupScroll} contentContainerStyle={{paddingBottom:18}}>
   {GROUPS.map(group=><View key={group.id} style={s.group}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded:expanded.includes(group.id)}} onPress={()=>toggle(group.id)} style={s.groupButton}>
     <View style={{flex:1}}><Text style={s.groupTitle}>{group.title}</Text><Text style={s.groupHint}>{group.hint}</Text></View>
     <Text style={s.chevron}>{expanded.includes(group.id)?'−':'+'}</Text>
    </Pressable>
    {expanded.includes(group.id)&&<View style={s.groupBody}>
     <Text style={s.emptyText}>No verified data yet.</Text>
     <Text style={s.emptyHint}>This section will populate after the bottle is identified and its research is verified against reliable sources.</Text>
    </View>}
   </View>)}
  </ScrollView>
 </View>;
 const camera=<View style={[s.cameraPane,wide?s.wideCamera:null]}>
  <DiscoverARSurface style={StyleSheet.absoluteFill} active={active} onTrackingUpdate={e=>setTracking(e.nativeEvent)} onVisualCandidates={()=>{}} onRecognitionUpdate={e=>setRecognized({text:e.nativeEvent.text||[],barcodes:e.nativeEvent.barcodes||[],classifications:e.nativeEvent.classifications||[]})} onARError={e=>{setError(e.nativeEvent.message||'AR session error');setActive(false);}} />
  <View pointerEvents="none" style={s.cameraShade}/>
  {active&&<Animated.View pointerEvents="none" style={[s.scanline,{transform:[{translateY:scanlineY}]}]}/>}
  <View style={s.cameraHeader}><View><Text style={s.eyebrow}>LIVE CAMERA · DEV</Text><Text style={s.cameraTitle}>Bottle detection</Text></View><View style={s.live}><Animated.View style={[s.dot,{opacity:pulse}]}/><Text style={s.liveText}>{tracking.state==='normal'?'TRACKING':active?'SCANNING':'READY'}</Text></View></View>
  <View style={s.cameraCenter}><View style={s.target}><View style={[s.corner,s.tl]}/><View style={[s.corner,s.tr]}/><View style={[s.corner,s.bl]}/><View style={[s.corner,s.br]}/><Text style={s.targetText}>BOTTLE INSTANCE MASK REQUIRED</Text></View></View>
  <View style={s.cameraFooter}>
   <Text style={s.noticeTitle}>FALSE OUTLINES SUPPRESSED</Text>
   <Text style={s.noticeText}>Generic rectangle proposals are no longer drawn as bottle detections. A bottle-specific segmentation model is still required before bottle outlines and counts can appear.</Text>
   {!!error&&<Text style={s.error}>{error}</Text>}
   <View style={s.actions}><Pressable style={s.secondary} onPress={()=>setActive(false)}><Text style={s.secondaryText}>PAUSE</Text></Pressable><Pressable style={s.primary} onPress={()=>void start()}><Text style={s.primaryText}>{active?'RESUME CAMERA':'START LIVE CAMERA'}</Text></Pressable></View>
  </View>
 </View>;
 return <View style={s.root}>
  <View style={s.topbar}><Pressable onPress={()=>{setActive(false);router.back();}}><Text style={s.back}>‹ BACK</Text></Pressable><View style={s.brand}><Text style={s.brandTop}>HARMONY</Text><Text style={s.brandSub}>DISCOVER INTELLIGENCE</Text></View><Text style={s.devTag}>DEV</Text></View>
  <View style={[s.content,wide?s.wideContent:null]}>{wide?<>{infoPanel}{camera}</>:<>{camera}{infoPanel}</>}</View>
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg,paddingTop:52},topbar:{height:48,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},back:{color:C.white,fontSize:10,fontWeight:'800',letterSpacing:1.4},brand:{alignItems:'center'},brandTop:{color:C.white,fontSize:13,fontWeight:'900',letterSpacing:3},brandSub:{color:C.gold,fontSize:7,fontWeight:'800',letterSpacing:1.8,marginTop:3},devTag:{color:C.gold,fontSize:9,fontWeight:'900',letterSpacing:1.5,borderWidth:1,borderColor:C.line,paddingHorizontal:9,paddingVertical:5,borderRadius:12},
 content:{flex:1},wideContent:{flexDirection:'row',padding:12,gap:12},infoPanel:{backgroundColor:C.panel,borderTopWidth:1,borderColor:C.line,flex:1,minHeight:270},wideInfo:{flex:0,width:'42%',borderWidth:1,borderRadius:14,overflow:'hidden'},infoHeader:{paddingHorizontal:16,paddingTop:15,paddingBottom:12,borderBottomWidth:1,borderColor:C.line},eyebrow:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1.8},infoTitle:{color:C.white,fontSize:22,fontWeight:'800',marginTop:5},infoSub:{color:C.muted,fontSize:10,lineHeight:15,marginTop:5},statusRow:{flexDirection:'row',alignItems:'center',gap:7,marginTop:10},statusDot:{width:6,height:6,borderRadius:3,backgroundColor:C.amber},statusText:{color:C.amber,fontSize:8,fontWeight:'900',letterSpacing:1},
 groupScroll:{flex:1},group:{borderBottomWidth:1,borderColor:'rgba(198,163,106,0.13)'},groupButton:{minHeight:54,paddingHorizontal:16,paddingVertical:9,flexDirection:'row',alignItems:'center',gap:10},groupTitle:{color:C.white,fontSize:12,fontWeight:'700'},groupHint:{color:C.muted,fontSize:9,marginTop:3},chevron:{color:C.gold,fontSize:22,fontWeight:'300',width:24,textAlign:'center'},groupBody:{paddingHorizontal:16,paddingBottom:13,paddingTop:2},emptyText:{color:C.amber,fontSize:10,fontWeight:'800'},emptyHint:{color:C.muted,fontSize:9,lineHeight:14,marginTop:4},
 cameraPane:{flex:1,minHeight:300,backgroundColor:'#030609',overflow:'hidden'},wideCamera:{flex:1,borderWidth:1,borderColor:C.line,borderRadius:14},cameraShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(4,7,12,.2)'},cameraHeader:{position:'absolute',top:14,left:15,right:15,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},cameraTitle:{color:C.white,fontSize:17,fontWeight:'800',marginTop:4},live:{flexDirection:'row',alignItems:'center',gap:6,padding:8,borderRadius:18,backgroundColor:C.panel,borderWidth:1,borderColor:C.line},dot:{width:6,height:6,borderRadius:3,backgroundColor:C.green},liveText:{color:C.white,fontSize:8,fontWeight:'900',letterSpacing:1},cameraCenter:{position:'absolute',top:'24%',bottom:'24%',left:15,right:15,alignItems:'center',justifyContent:'center'},target:{width:'88%',height:'88%',alignItems:'center',justifyContent:'center'},corner:{position:'absolute',width:25,height:25,borderColor:C.gold},tl:{top:0,left:0,borderTopWidth:2,borderLeftWidth:2},tr:{top:0,right:0,borderTopWidth:2,borderRightWidth:2},bl:{bottom:0,left:0,borderBottomWidth:2,borderLeftWidth:2},br:{bottom:0,right:0,borderBottomWidth:2,borderRightWidth:2},targetText:{color:'rgba(240,241,242,.65)',fontSize:8,fontWeight:'900',letterSpacing:1.2},scanline:{position:'absolute',top:'12%',left:24,right:24,height:1,backgroundColor:'#4F8BFF',opacity:.7},cameraFooter:{position:'absolute',bottom:12,left:12,right:12,padding:12,borderRadius:13,backgroundColor:'rgba(7,10,15,.94)',borderWidth:1,borderColor:C.line},noticeTitle:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:.8},noticeText:{color:C.muted,fontSize:9,lineHeight:14,marginTop:4},recognitionText:{color:C.green,fontSize:9,lineHeight:14,marginTop:5,fontWeight:'700'},error:{color:'#FF9A9A',fontSize:10,marginTop:7},actions:{flexDirection:'row',gap:8,marginTop:10},secondary:{flex:1,padding:12,alignItems:'center',borderRadius:9,borderWidth:1,borderColor:C.line},secondaryText:{color:C.white,fontSize:9,fontWeight:'900',letterSpacing:1},primary:{flex:2,padding:12,alignItems:'center',borderRadius:9,backgroundColor:C.gold},primaryText:{color:'#101216',fontSize:9,fontWeight:'900',letterSpacing:1},
});
