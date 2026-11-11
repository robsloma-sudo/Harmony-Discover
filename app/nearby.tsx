import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Screen, styles, colors } from '../src/ui';
import { findNearbyVenues, type DiscoverVenue, type VenueRadius } from '../src/services/discoverVenueApi';

const radii: VenueRadius[] = [1,5,10,15,20];
const filters = [
  {label:'All',value:''},{label:'Bars',value:'bar'},{label:'Cocktail bars',value:'cocktail_bar'},
  {label:'Restaurants',value:'restaurant'},{label:'Breweries',value:'brewery'},
  {label:'Wineries',value:'winery'},{label:'Distilleries',value:'distillery'}
];
function locationErrorMessage(error: unknown) {
  if(error && typeof error==='object' && 'code' in error && error.code===1) return 'Location permission was denied. Enable location access in your browser or device settings.';
  if(error && typeof error==='object' && 'code' in error && error.code===3) return 'Location request timed out. Try again.';
  return 'We could not determine your location. Check location services and try again.';
}
export default function Nearby() {
  const [radius,setRadius]=useState<VenueRadius>(5);
  const [category,setCategory]=useState('');
  const [venues,setVenues]=useState<DiscoverVenue[]>([]);
  const [coords,setCoords]=useState<{latitude:number;longitude:number}|null>(null);
  const [loading,setLoading]=useState(false);
  const [locating,setLocating]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const loadLocation=useCallback(()=>{
    if(Platform.OS!=='web' || typeof navigator==='undefined' || !navigator.geolocation){
      setError('Location services are not available in this browser session. Open Discover in a browser that supports location access.');
      return;
    }
    setLocating(true);setError('');
    navigator.geolocation.getCurrentPosition(position=>{
      setCoords({latitude:position.coords.latitude,longitude:position.coords.longitude});
      setLocating(false);
    },err=>{setError(locationErrorMessage(err));setLocating(false);},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
  },[]);
  useEffect(()=>{loadLocation();},[loadLocation]);
  useEffect(()=>{
    if(!coords)return;
    let active=true;
    setLoading(true);setError('');
    findNearbyVenues(coords.latitude,coords.longitude,radius,category||null)
      .then(rows=>{if(active)setVenues(rows);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load nearby venues.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[coords,radius,category]);
  const filtered=useMemo(()=>venues.filter(v=>v.name.toLowerCase().includes(query.trim().toLowerCase()) || (v.locality||'').toLowerCase().includes(query.trim().toLowerCase())),[venues,query]);
  const openMap=(v:DiscoverVenue)=>Linking.openURL('https://www.openstreetmap.org/?mlat='+v.latitude+'&mlon='+v.longitude+'#map=17/'+v.latitude+'/'+v.longitude);
  return <Screen>
    <Text style={styles.eyebrow}>DISCOVER AROUND YOU</Text>
    <Text style={styles.title}>Venue Atlas</Text>
    <Text style={styles.sub}>Explore bars, restaurants, breweries, wineries and more around your current location.</Text>
    <View style={{backgroundColor:colors.panel,borderColor:colors.border,borderWidth:1,borderRadius:18,padding:16,marginBottom:16}}>
      <Text style={{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:1.4}}>SEARCH RADIUS</Text>
      <View style={{flexDirection:'row',gap:7,marginTop:12}}>
        {radii.map(miles=><Pressable key={miles} onPress={()=>setRadius(miles)} style={{flex:1,paddingVertical:12,borderRadius:11,alignItems:'center',backgroundColor:radius===miles?colors.accent:'#202A35',borderWidth:1,borderColor:radius===miles?colors.accent:colors.border}}>
          <Text style={{color:radius===miles?'#111820':colors.text,fontWeight:'800',fontSize:13}}>{miles}</Text><Text style={{color:radius===miles?'#34302A':colors.muted,fontSize:9,fontWeight:'700'}}>MILE{miles===1?'':'S'}</Text>
        </Pressable>)}
      </View>
      <Pressable onPress={loadLocation} disabled={locating} style={{marginTop:13,padding:12,borderRadius:11,borderWidth:1,borderColor:colors.border,alignItems:'center',flexDirection:'row',justifyContent:'center',gap:8}}>
        {locating?<ActivityIndicator color={colors.accent}/>:<Text style={{color:colors.accent,fontWeight:'800'}}>◎  {coords?'UPDATE MY LOCATION':'USE MY CURRENT LOCATION'}</Text>}
      </Pressable>
      {coords&&<Text style={{color:colors.muted,fontSize:10,marginTop:8,textAlign:'center'}}>Location acquired · searching within {radius} miles</Text>}
    </View>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search venues or towns" placeholderTextColor={colors.muted} style={{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:14,color:colors.text,marginBottom:12}}/>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12}}>
      {filters.map(f=><Pressable key={f.value} onPress={()=>setCategory(f.value)} style={{paddingHorizontal:12,paddingVertical:8,borderRadius:20,backgroundColor:category===f.value?colors.accent:colors.panel,borderWidth:1,borderColor:category===f.value?colors.accent:colors.border}}>
        <Text style={{color:category===f.value?'#111820':colors.text,fontSize:11,fontWeight:'700'}}>{f.label}</Text>
      </Pressable>)}
    </View>
    {error?<View style={{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:16,marginBottom:12}}><Text style={{color:'#E6A18F',lineHeight:21}}>{error}</Text><Pressable onPress={loadLocation} style={{marginTop:12}}><Text style={{color:colors.accent,fontWeight:'800'}}>TRY AGAIN</Text></Pressable></View>:null}
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:8,marginBottom:10}}>
      <Text style={{color:colors.text,fontWeight:'800',fontSize:16}}>VENUES NEAR YOU</Text>
      <Text style={{color:colors.muted,fontSize:11}}>{loading?'Searching…':filtered.length+' results'}</Text>
    </View>
    {loading?<ActivityIndicator color={colors.accent} style={{padding:24}}/>:null}
    {!loading&&coords&&filtered.length===0&&!error?<View style={{padding:18,borderRadius:14,backgroundColor:colors.panel}}><Text style={{color:colors.text,fontWeight:'700'}}>No venues found in this radius yet.</Text><Text style={{color:colors.muted,fontSize:12,lineHeight:19,marginTop:6}}>The Atlas directory is being populated. Try a larger radius or another category.</Text></View>:null}
    {filtered.map(v=><View key={v.id} style={{padding:15,marginBottom:9,borderRadius:15,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',gap:12}}>
        <View style={{flex:1}}>
          <Text style={{color:colors.text,fontSize:15,fontWeight:'800'}}>{v.name}</Text>
          <Text style={{color:colors.accent,fontSize:10,fontWeight:'800',textTransform:'uppercase',letterSpacing:1,marginTop:5}}>{v.venue_type.replace('_',' ')}</Text>
          <Text style={{color:colors.muted,fontSize:11,marginTop:5}}>{[v.locality,v.region].filter(Boolean).join(', ')||v.address_line||'Address not available'}</Text>
          {v.description?<Text style={{color:colors.muted,fontSize:12,lineHeight:18,marginTop:7}}>{v.description}</Text>:null}
        </View>
        <View style={{alignItems:'flex-end'}}>
          <Text style={{color:colors.text,fontWeight:'800'}}>{v.distance_miles.toFixed(1)} mi</Text>
          <Text style={{color:colors.muted,fontSize:9,marginTop:4}}>{v.verification_status.replace('_',' ')}</Text>
        </View>
      </View>
      <Pressable onPress={()=>openMap(v)} style={{alignSelf:'flex-start',paddingVertical:9,marginTop:7}}><Text style={{color:colors.accent,fontSize:11,fontWeight:'800'}}>OPEN IN MAP ↗</Text></Pressable>
    </View>)}
    <Text style={styles.footnote}>Venue availability depends on the Discover directory and its verified sources. Your location is used to calculate nearby results and is not saved as a venue record.</Text>
  </Screen>;
}
