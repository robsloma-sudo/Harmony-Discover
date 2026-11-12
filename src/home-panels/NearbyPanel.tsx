import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useWindowDimensions} from 'react-native';
import {ActivityIndicator,Linking,Platform,Pressable,ScrollView,Text,TextInput,View,PanResponder} from 'react-native';
import {colors} from '../ui';
import {findNearbyPhgAtlasVenues,type DiscoverVenue,type VenueRadius} from '../services/discoverVenueApi';
import {AtlasMap} from './AtlasMap';
import type {JourneyScanItem} from './JourneyPlayerOverlay';

const radii:VenueRadius[]=[1,5,10,15,25];
const filters=[{label:'All',value:''},{label:'Bars',value:'bar'},{label:'Cocktail bars',value:'cocktail_bar'},{label:'Restaurants',value:'restaurant'},{label:'Breweries',value:'brewery'},{label:'Wineries',value:'winery'},{label:'Distilleries',value:'distillery'}];
type NearbyCommand = { id:number; action:'set_radius'|'set_category'|'search'|'recenter'|'configure'; radius_miles?:number; category?:string; search?:string };

export default function NearbyPanel({command,onCommandResult,journeyItems=[],onOpenJourney}:{command?:NearbyCommand|null;onCommandResult?:(id:number,result:string)=>void;journeyItems?:JourneyScanItem[];onOpenJourney?:(item:JourneyScanItem)=>void}){
 const {height:screenHeight}=useWindowDimensions();
 const [radius,setRadius]=useState<VenueRadius>(5),[settledRadius,setSettledRadius]=useState<VenueRadius>(5),[category,setCategory]=useState(''),[venues,setVenues]=useState<DiscoverVenue[]>([]),[coords,setCoords]=useState<{latitude:number;longitude:number}|null>(null),[loading,setLoading]=useState(false),[locating,setLocating]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[selectedVenue,setSelectedVenue]=useState<string|null>(null),[journeysOpen,setJourneysOpen]=useState(false);
 const locate=useCallback(()=>new Promise<string>(resolve=>{
  if(typeof navigator==='undefined'||!navigator.geolocation){const message='Location permission is not available in this build yet.';setError(message);resolve(message);return;}
  setLocating(true);setError('');
  navigator.geolocation.getCurrentPosition(p=>{setCoords({latitude:p.coords.latitude,longitude:p.coords.longitude});setLocating(false);resolve('Atlas recentered on your current location.');},e=>{const message=e.code===1?'Location access is blocked. Enable it in browser settings.':e.code===3?'Location request timed out. Try again.':'Could not determine your location.';setError(message);setLocating(false);resolve(message);},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
 }),[]);
 const sliderWidth=useRef(1);
 const sliderResponder=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:(e)=>{const w=Math.max(1,sliderWidth.current);setRadius(Math.round((1+24*Math.max(0,Math.min(1,e.nativeEvent.locationX/w)))*2)/2);},onPanResponderMove:(e)=>{const w=Math.max(1,sliderWidth.current);setRadius(Math.round((1+24*Math.max(0,Math.min(1,e.nativeEvent.locationX/w)))*2)/2);}}),[]);
 useEffect(()=>{const timer=setTimeout(()=>setSettledRadius(radius),500);return()=>clearTimeout(timer);},[radius]);\n const lastCommandId=useRef<number|null>(null);
 useEffect(()=>{if(!command||lastCommandId.current===command.id)return;lastCommandId.current=command.id;void(async()=>{
  if(command.action==='recenter'){onCommandResult?.(command.id,await locate());return;}
  const applied:string[]=[];
  if(command.action==='set_radius'||command.action==='configure'){if(command.radius_miles&&command.radius_miles>=1&&command.radius_miles<=25){setRadius(command.radius_miles as VenueRadius);setSettledRadius(command.radius_miles as VenueRadius);applied.push('radius');}}
  if(command.action==='set_category'||command.action==='configure'){if(typeof command.category==='string'&&filters.some(f=>f.value===command.category)){setCategory(command.category);applied.push('category');}}
  if(command.action==='search'||command.action==='configure'){if(typeof command.search==='string'&&command.search.trim()){setQuery(command.search.trim());applied.push('search');}}
  onCommandResult?.(command.id,applied.length?('Applied Nearby Atlas '+applied.join(', ')+'.'):'I need a valid radius, category, or search phrase to do that.');
 })();},[command,locate,onCommandResult]);
 useEffect(()=>{if(!coords)return;let active=true;setLoading(true);setError('');findNearbyPhgAtlasVenues(coords.latitude,coords.longitude,settledRadius,category||null).then(rows=>{if(active){setVenues(rows);if(selectedVenue&&!rows.some(v=>v.id===selectedVenue))setSelectedVenue(null);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Nearby search failed.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;}},[coords,settledRadius,category]);
 const filtered=useMemo(()=>venues.filter(v=>v.name.toLowerCase().includes(query.trim().toLowerCase())||(v.locality||'').toLowerCase().includes(query.trim().toLowerCase())),[venues,query]);
 const selected=filtered.find(v=>v.id===selectedVenue)||null;
 const venuePins=filtered.map(v=>({id:v.id,name:v.name,latitude:v.latitude,longitude:v.longitude}));
 const openVenue=(v:DiscoverVenue)=>{setSelectedVenue(v.id);};
 return <ScrollView style={{flex:1,minHeight:0}} contentContainerStyle={{paddingBottom:10}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
  
  <AtlasMap center={coords} venues={venuePins} onSelectVenue={id=>setSelectedVenue(id)} fitKey={`${settledRadius}-${filtered.length}-${filtered[0]?.latitude}-${filtered[0]?.longitude}-${filtered[filtered.length-1]?.latitude}-${filtered[filtered.length-1]?.longitude}`} height={Math.max(360,Math.min(screenHeight*0.52,620))}/>
  <Pressable onPress={locate} disabled={locating} style={{padding:11,backgroundColor:colors.accent,borderRadius:9,alignItems:'center',marginTop:9,marginBottom:9}}>{locating?<ActivityIndicator color="#111"/>:<Text style={{color:'#111',fontSize:10,fontWeight:'900'}}>{coords?'RECENTER ATLAS':'ENABLE LOCATION & LOAD ATLAS'}</Text>}</Pressable>

  <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:7}}>
   <Text style={{color:colors.text,fontSize:9,fontWeight:'900',letterSpacing:1}}>JOURNEYS</Text>
   <Text style={{color:colors.muted,fontSize:9}}>{journeyItems.length}</Text>
  </View>
  <Pressable disabled={!journeyItems.length} onPress={()=>setJourneysOpen(v=>!v)} style={{padding:12,borderRadius:10,borderWidth:1,borderColor:journeyItems.length?'rgba(74,137,255,0.85)':'rgba(74,137,255,0.25)',backgroundColor:journeyItems.length?'rgba(24,65,130,0.28)':'rgba(14,25,44,0.42)',flexDirection:'row',alignItems:'center',justifyContent:'space-between',opacity:journeyItems.length?1:0.62}}>
   <View><Text style={{color:'#DCEBFF',fontSize:11,fontWeight:'900',letterSpacing:1.2}}>JOURNEYS</Text><Text style={{color:'#94B8EA',fontSize:9,marginTop:3}}>{journeyItems.length?'Choose an item detected in your last photo':'Scan and read a bottle or menu to enable'}</Text></View>
   <Text style={{color:'#A8CCFF',fontSize:12,fontWeight:'900'}}>{journeyItems.length?(journeysOpen?'−':'＋'):'LOCKED'}</Text>
  </Pressable>
  {journeysOpen&&journeyItems.map(item=><Pressable key={item.id} onPress={()=>onOpenJourney?.(item)} style={{marginTop:6,padding:11,borderRadius:9,backgroundColor:'rgba(11,24,44,0.82)',borderWidth:1,borderColor:'rgba(74,137,255,0.25)'}}>
   <Text style={{color:'#EAF2FF',fontSize:11,fontWeight:'800'}}>{item.name}</Text><Text style={{color:'#91A9CB',fontSize:9,marginTop:3}}>{item.kind==='bottle'?'BOTTLE':'MENU ITEM'}{item.subtitle?' · '+item.subtitle:''}</Text><Text style={{color:'#78AFFF',fontSize:8,fontWeight:'900',letterSpacing:1,marginTop:7}}>OPEN JOURNEY PLAYER →</Text>
  </Pressable>)}
  {journeysOpen&&<Text style={{color:colors.muted,fontSize:9,lineHeight:14,marginTop:8}}>Playback is waiting for Harmony's approved public journey connection. This list reflects the scan only; it does not claim a matching published journey exists.</Text>}

  <TextInput value={query} onChangeText={setQuery} placeholder="Search venues or towns" placeholderTextColor={colors.muted} style={{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:9,padding:10,color:colors.text,marginTop:8,marginBottom:6}}/>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:5,marginBottom:8}}>{radii.map(n=><Pressable key={n} onPress={()=>setRadius(n)} style={{padding:8,borderRadius:8,backgroundColor:Math.abs(radius-n)<0.01?colors.accent:colors.panel,borderWidth:1,borderColor:Math.abs(radius-n)<0.01?colors.accent:colors.border}}><Text style={{color:Math.abs(radius-n)<0.01?'#111':colors.text,fontSize:10,fontWeight:'900'}}>{n} MI</Text></Pressable>)}</View>\n  <View style={{marginBottom:10,padding:10,borderRadius:10,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border}}>\n   <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}><Text style={{color:colors.text,fontSize:10,fontWeight:'900'}}>CUSTOM RADIUS</Text><Text style={{color:colors.accent,fontSize:11,fontWeight:'900'}}>{radius.toFixed(radius%1?1:0)} MILES</Text></View>\n   <View onLayout={e=>{sliderWidth.current=e.nativeEvent.layout.width;}} {...sliderResponder.panHandlers} style={{height:28,justifyContent:'center'}}>\n    <View style={{height:5,borderRadius:4,backgroundColor:colors.border}}/><View style={{position:'absolute',left:0,width:`${((radius-1)/24)*100}%`,height:5,borderRadius:4,backgroundColor:colors.accent}}/><View style={{position:'absolute',left:`${((radius-1)/24)*100}%`,marginLeft:-9,width:18,height:18,borderRadius:9,backgroundColor:colors.accent,borderWidth:2,borderColor:'#F5F7FA'}}/>\n   </View><View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{color:colors.muted,fontSize:8}}>1 MI</Text><Text style={{color:colors.muted,fontSize:8}}>25 MI</Text></View>\n  </View>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:5,marginBottom:8}}>{filters.map(f=><Pressable key={f.value} onPress={()=>setCategory(f.value)} style={{padding:7,borderRadius:14,backgroundColor:category===f.value?colors.accent:colors.panel}}><Text style={{color:category===f.value?'#111':colors.text,fontSize:9,fontWeight:'700'}}>{f.label}</Text></Pressable>)}</View>
  <Text style={{color:colors.text,fontSize:10,fontWeight:'900',marginBottom:6}}>{loading?'SEARCHING ATLAS…':filtered.length+' VENUES'}</Text>
  {error?<Text style={{color:'#E6A18F',fontSize:10,marginBottom:6}}>{error}</Text>:null}
  {selected&&<View style={{padding:11,marginBottom:8,borderRadius:10,backgroundColor:'rgba(23,54,100,0.42)',borderWidth:1,borderColor:'rgba(74,137,255,0.5)'}}>
   <Text style={{color:'#EAF2FF',fontSize:12,fontWeight:'900'}}>{selected.name}</Text>
   <Text style={{color:'#A8B7D0',fontSize:9,marginTop:3}}>{[selected.locality,selected.region].filter(Boolean).join(', ')||selected.address_line||'Address unavailable'} · {selected.distance_miles.toFixed(1)} mi</Text>
   <Text style={{color:'#8DBBFF',fontSize:9,marginTop:6}}>Journey availability will appear after the Harmony connection is approved.</Text>
   <Pressable onPress={()=>Linking.openURL('https://www.openstreetmap.org/?mlat='+selected.latitude+'&mlon='+selected.longitude+'#map=16/'+selected.latitude+'/'+selected.longitude)}><Text style={{color:'#8DBBFF',fontSize:9,fontWeight:'900',marginTop:8}}>OPEN IN MAPS ↗</Text></Pressable>
  </View>}
  {filtered.map(v=><Pressable key={v.id} onPress={()=>openVenue(v)} style={{padding:10,marginBottom:6,borderRadius:9,backgroundColor:selectedVenue===v.id?'rgba(26,63,117,0.5)':colors.panel,borderWidth:1,borderColor:selectedVenue===v.id?'rgba(74,137,255,0.65)':'transparent'}}>
   <Text style={{color:colors.text,fontWeight:'800',fontSize:11}}>{v.name}</Text>
   <Text style={{color:colors.muted,fontSize:9,marginTop:3}}>{[v.locality,v.region].filter(Boolean).join(', ')||v.address_line||'Address unavailable'} · {v.distance_miles.toFixed(1)} mi</Text>
   <Text style={{color:'#79AFFF',fontSize:8,fontWeight:'800',letterSpacing:0.8,marginTop:5}}>SELECT VENUE</Text>
  </Pressable>)}
  {Platform.OS!=='web'&&!coords&&<Text style={{color:colors.muted,fontSize:9,marginTop:8}}>On-device location permission support will be added with the native map pass.</Text>}
 </ScrollView>;
}
