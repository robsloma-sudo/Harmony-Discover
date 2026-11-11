import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { DiscoverARSurface, type ARTrackingUpdate } from '../src/live/DiscoverARSurface';

const C={bg:'#07090C',panel:'rgba(8,12,18,0.88)',line:'rgba(198,163,106,0.35)',gold:'#C6A36A',white:'#F0F1F2',muted:'#929AA5',blue:'#4F8BFF',green:'#7DFFB5',amber:'#FFD27A'};
export default function LiveInventory(){
 const [permission,requestPermission]=useCameraPermissions();
 const [active,setActive]=useState(false);
 const [tracking,setTracking]=useState<ARTrackingUpdate>({state:'paused',reason:'not_started'});
 const [candidates,setCandidates]=useState<Array<{trackId:number;confidence:number;x:number;y:number;width:number;height:number}>>([]);
 const [error,setError]=useState('');
 const pulse=useRef(new Animated.Value(.35)).current;
 const sweep=useRef(new Animated.Value(0)).current;
 useEffect(()=>{const a=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:1,duration:950,useNativeDriver:true}),Animated.timing(pulse,{toValue:.35,duration:950,useNativeDriver:true})]));a.start();return()=>a.stop();},[pulse]);
 useEffect(()=>{if(!active)return;const a=Animated.loop(Animated.timing(sweep,{toValue:1,duration:2600,useNativeDriver:true}));a.start();return()=>a.stop();},[active,sweep]);
 const start=async()=>{setError('');if(!permission?.granted){const p=await requestPermission();if(!p.granted){setError('Camera permission is required.');return;}}setActive(true);};
 const scanlineY=sweep.interpolate({inputRange:[0,1],outputRange:[0,440]});
 return <View style={s.root}>
  <DiscoverARSurface style={StyleSheet.absoluteFill} active={active} onTrackingUpdate={e=>setTracking(e.nativeEvent)} onVisualCandidates={e=>setCandidates(e.nativeEvent.candidates)} onARError={e=>{setError(e.nativeEvent.message||'AR session error');setActive(false);}} />
  <View pointerEvents="none" style={s.shade}/>
  <View style={s.header}><Pressable onPress={()=>{setActive(false);router.back();}}><Text style={s.back}>‹ BACK</Text></Pressable><View style={s.brand}><Text style={s.brandTop}>HARMONY</Text><Text style={s.brandSub}>LIVE INVENTORY</Text></View><View style={s.live}><Animated.View style={[s.dot,{opacity:pulse}]}/><Text style={s.liveText}>{tracking.state==='normal'?'TRACKING':active?'SCANNING':'READY'}</Text></View></View>
  <View style={s.topPanel}><Text style={s.eyebrow}>BOTTLE SCANNER · DEV</Text><Text style={s.heading}>Sweep the back bar</Text><Text style={s.sub}>Move slowly across the shelf. Keep bottle labels visible and avoid fast camera movement.</Text></View>
  {active&&<><Animated.View pointerEvents="none" style={[s.scanline,{transform:[{translateY:scanlineY}]}]}/><View pointerEvents="none" style={s.reticle}><View style={[s.corner,s.tl]}/><View style={[s.corner,s.tr]}/><View style={[s.corner,s.bl]}/><View style={[s.corner,s.br]}/></View></>}
  <View style={s.bottom}>
   <View style={s.stats}>
    <View style={s.stat}><Text style={s.statValue}>{candidates.length}</Text><Text style={s.statLabel}>VISUAL REGIONS</Text></View>
    <View style={s.statDivider}/>
    <View style={s.stat}><Text style={[s.statValue,{color:tracking.state==='normal'?C.green:C.amber}]}>{tracking.state==='normal'?'GOOD':tracking.state==='limited'?'LIMITED':'—'}</Text><Text style={s.statLabel}>AR TRACKING</Text></View>
    <View style={s.statDivider}/>
    <View style={s.stat}><Text style={s.statValue}>4 FPS</Text><Text style={s.statLabel}>ANALYSIS CAP</Text></View>
   </View>
   <View style={s.notice}><Text style={s.noticeTitle}>LIVE PREVIEW — NOT YET BOTTLE RECOGNITION</Text><Text style={s.noticeText}>Blue outlines are generic visual regions. Bottle identity, SKU counting and liquid measurement are not active in this build.</Text></View>
   {!!error&&<Text style={s.error}>{error}</Text>}
   <View style={s.actions}><Pressable style={s.secondary} onPress={()=>{setActive(false);setCandidates([]);setTracking({state:'paused',reason:'user_paused'});}}><Text style={s.secondaryText}>PAUSE</Text></Pressable><Pressable style={s.primary} onPress={()=>void start()}><Text style={s.primaryText}>{active?'RESUME SCAN':'START LIVE SCAN'}</Text></Pressable></View>
  </View>
 </View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg},shade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(4,7,12,.26)'},header:{position:'absolute',top:58,left:20,right:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},back:{color:C.white,fontSize:10,fontWeight:'800',letterSpacing:1.4},brand:{alignItems:'center'},brandTop:{color:C.white,fontSize:14,fontWeight:'900',letterSpacing:3},brandSub:{color:C.gold,fontSize:8,fontWeight:'800',letterSpacing:2,marginTop:3},live:{flexDirection:'row',alignItems:'center',gap:6,padding:8,borderRadius:18,backgroundColor:C.panel,borderWidth:1,borderColor:C.line},dot:{width:6,height:6,borderRadius:3,backgroundColor:C.green},liveText:{color:C.white,fontSize:9,fontWeight:'900',letterSpacing:1},topPanel:{position:'absolute',top:112,left:20,right:20,padding:16,borderRadius:14,backgroundColor:C.panel,borderWidth:1,borderColor:C.line},eyebrow:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:2},heading:{color:C.white,fontSize:22,fontWeight:'800',marginTop:7},sub:{color:C.muted,fontSize:11,lineHeight:17,marginTop:5},reticle:{position:'absolute',top:'32%',bottom:'32%',left:25,right:25},corner:{position:'absolute',width:28,height:28,borderColor:C.gold},tl:{top:0,left:0,borderTopWidth:2,borderLeftWidth:2},tr:{top:0,right:0,borderTopWidth:2,borderRightWidth:2},bl:{bottom:0,left:0,borderBottomWidth:2,borderLeftWidth:2},br:{bottom:0,right:0,borderBottomWidth:2,borderRightWidth:2},scanline:{position:'absolute',top:'30%',left:30,right:30,height:2,backgroundColor:C.blue,shadowColor:C.blue,shadowOpacity:.9,shadowRadius:9},bottom:{position:'absolute',left:12,right:12,bottom:24,padding:13,borderRadius:18,backgroundColor:'rgba(7,10,15,.94)',borderWidth:1,borderColor:C.line},stats:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingVertical:8},stat:{alignItems:'center',flex:1},statValue:{color:C.white,fontSize:17,fontWeight:'900'},statLabel:{color:C.muted,fontSize:7,fontWeight:'900',letterSpacing:1,marginTop:4},statDivider:{width:1,height:30,backgroundColor:C.line},notice:{padding:11,borderRadius:10,backgroundColor:'rgba(198,163,106,.08)',borderWidth:1,borderColor:'rgba(198,163,106,.22)',marginTop:8},noticeTitle:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:.8},noticeText:{color:C.muted,fontSize:10,lineHeight:15,marginTop:4},error:{color:'#FF9A9A',fontSize:10,marginTop:8},actions:{flexDirection:'row',gap:9,marginTop:12},secondary:{flex:1,padding:15,alignItems:'center',borderRadius:10,borderWidth:1,borderColor:C.line},secondaryText:{color:C.white,fontSize:10,fontWeight:'900',letterSpacing:1},primary:{flex:2,padding:15,alignItems:'center',borderRadius:10,backgroundColor:C.gold},primaryText:{color:'#101216',fontSize:10,fontWeight:'900',letterSpacing:1}});
