import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Screen, styles, colors } from '../src/ui';
import { findNearbyVenues, type DiscoverVenue, type VenueRadius } from '../src/services/discoverVenueApi';

const radii: VenueRadius[] = [1,5,10,15,20];
const filters = [
  {label:'All',value:''},{label:'Bars',value:'bar'},{label:'Cocktail bars',value:'cocktail_bar'},
  {label:'Restaurants',value:'restaurant'},{label:'Breweries',value:'brewery'},
  {label:'Wineries',value:'winery'},{label:'Distilleries',value:'distillery'}
];
const worldMap = 'https://staticmap.openstreetmap.de/staticmap.php?center=20,0&zoom=1&size=900x520&maptype=mapnik';
function locationErrorMessage(error: unknown) {
  if(error && typeof error==='object' && 'code' in error && error.code===1) return 'Location access is blocked. Enable location for Harmony Discover in your browser or device settings, then tap Try again.';
  if(error && typeof error==='object' && 'code' in error && error.code===3) return 'Your location request timed out. Try again.';
  return 'We could not determine your location. Check that location services are enabled and try again.';
}
function mapUrl(latitude:number,longitude:number,zoom=13) {
  return 'https://staticmap.openstreetmap.de/staticmap.php?center='+latitude+','+longitude+'&zoom='+zoom+'&size=900x520&maptype=mapnik&markers='+latitude+','+longitude+',red-pushpin';
}
export default function Nearby() {
  const params = useLocalSearchParams<{ radius?: string; category?: string; search?: string; recenter?: string }>();
  const [radius,setRadius]=useState<VenueRadius>([1,5,10,15,20].includes(Number(params.radius)) ? Number(params.radius) as VenueRadius : 5);
  const [category,setCategory]=useState(typeof params.category === 'string' ? params.category : '');
  const [venues,setVenues]=useState<DiscoverVenue[]>([]);
  const [coords,setCoords]=useState<{latitude:number;longitude:number}|null>(null);
  const [loading,setLoading]=useState(false);
  const [locating,setLocating]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState(typeof params.search === 'string' ? params.search : '');
  const [mapFailed,setMapFailed]=useState(false);

  const loadLocation=useCallback(()=>{
    if(Platform.OS!=='web' || typeof navigator==='undefined' || !navigator.geolocation){
      setError('Location permission is available in the web version. Open Harmony Discover in Safari or another browser with location services enabled.');
      return;
    }
    setLocating(true);setError('');
    navigator.geolocation.getCurrentPosition(position=>{
      setCoords({latitude:position.coords.latitude,longitude:position.coords.longitude});
      setMapFailed(false);
      setLocating(false);
    },err=>{setError(locationErrorMessage(err));setLocating(false);},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  },[]);

  useEffect(()=>{
    if (typeof params.radius === 'string' && [1,5,10,15,20].includes(Number(params.radius))) setRadius(Number(params.radius) as VenueRadius);
    if (typeof params.category === 'string' && ['', 'all', 'bar', 'cocktail_bar', 'restaurant', 'brewery', 'winery', 'distillery'].includes(params.category)) setCategory(params.category === 'all' ? '' : params.category);
    if (typeof params.search === 'string') setQuery(params.search.slice(0,100));
  },[params.radius,params.category,params.search]);

  useEffect(()=>{
    if (params.recenter) loadLocation();
  },[params.recenter,loadLocation]);

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
  const activeMapUrl=coords?mapUrl(coords.latitude,coords.longitude,13):worldMap;
  const openMap=(v:DiscoverVenue)=>Linking.openURL('https://www.openstreetmap.org/?mlat='+v.latitude+'&mlon='+v.longitude+'#map=16/'+v.latitude+'/'+v.longitude);

  return <Screen>
    <Text style={styles.eyebrow}>HARMONY DISCOVER · ATLAS</Text>
    <Text style={styles.title}>Explore the world.</Text>
    <Text style={styles.sub}>Start with the full world atlas, then zoom straight to your location to discover venues around you.</Text>

    <View style={{height:270,borderRadius:20,overflow:'hidden',backgroundColor:'#17232D',borderWidth:1,borderColor:colors.border,marginBottom:14}}>
      {!mapFailed?<Image source={{uri:activeMapUrl}} onError={()=>setMapFailed(true)} resizeMode="cover" style={{width:'100%',height:'100%'}}/>:
        <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24}}>
          <Text style={{color:colors.text,fontWeight:'800',fontSize:17}}>{coords?'Your location is ready':'World Atlas'}</Text>
          <Text style={{color:colors.muted,textAlign:'center',marginTop:8,lineHeight:20}}>The map image could not load. Your location and nearby venue search can still work.</Text>
        </View>}
      <View style={{position:'absolute',left:12,right:12,bottom:12,backgroundColor:'rgba(13,17,23,0.88)',borderRadius:12,padding:11,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <View style={{flex:1}}>
          <Text style={{color:colors.text,fontSize:12,fontWeight:'800'}}>{coords?'ZOOMED TO YOUR LOCATION':'WORLD ATLAS'}</Text>
          <Text style={{color:colors.muted,fontSize:10,marginTop:3}}>{coords?coords.latitude.toFixed(4)+'°, '+coords.longitude.toFixed(4)+'°':'Enable location to fly to your position'}</Text>
        </View>
        {coords?<Pressable onPress={()=>Linking.openURL('https://www.openstreetmap.org/?mlat='+coords.latitude+'&mlon='+coords.longitude+'#map=13/'+coords.latitude+'/'+coords.longitude)}><Text style={{color:colors.accent,fontSize:10,fontWeight:'800'}}>OPEN MAP ↗</Text></Pressable>:null}
      </View>
    </View>

    {!coords?<View style={{backgroundColor:colors.panel,borderColor:colors.accent,borderWidth:1,borderRadius:17,padding:17,marginBottom:16}}>
      <Text style={{color:colors.text,fontSize:17,fontWeight:'800'}}>Enable your location</Text>
      <Text style={{color:colors.muted,fontSize:13,lineHeight:20,marginTop:7}}>Nearby needs permission to use your device location. Tap below and choose Allow when your browser asks. We use it to center the Atlas and calculate venue distances; we do not save your live location.</Text>
      <Pressable onPress={loadLocation} disabled={locating} style={{backgroundColor:colors.accent,borderRadius:12,padding:15,marginTop:14,alignItems:'center'}}>
        {locating?<ActivityIndicator color="#15191F"/>:<Text style={{color:'#15191F',fontWeight:'900',letterSpacing:0.5}}>ENABLE LOCATION & OPEN ATLAS</Text>}
      </Pressable>
      {error?<Text style={{color:'#E6A18F',fontSize:12,lineHeight:19,marginTop:12}}>{error}</Text>:null}
      {error?<Pressable onPress={loadLocation} style={{paddingTop:10}}><Text style={{color:colors.accent,fontWeight:'800'}}>TRY AGAIN</Text></Pressable>:null}
    </View>:<>
      <View style={{backgroundColor:colors.panel,borderColor:colors.border,borderWidth:1,borderRadius:17,padding:15,marginBottom:15}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
          <Text style={{color:colors.text,fontWeight:'800'}}>SEARCH RADIUS</Text>
          <Pressable onPress={loadLocation} disabled={locating}><Text style={{color:colors.accent,fontSize:10,fontWeight:'800'}}>{locating?'LOCATING…':'RECENTER'}</Text></Pressable>
        </View>
        <View style={{flexDirection:'row',gap:7,marginTop:12}}>
          {radii.map(miles=><Pressable key={miles} onPress={()=>setRadius(miles)} style={{flex:1,paddingVertical:12,borderRadius:11,alignItems:'center',backgroundColor:radius===miles?colors.accent:'#202A35',borderWidth:1,borderColor:radius===miles?colors.accent:colors.border}}>
            <Text style={{color:radius===miles?'#111820':colors.text,fontWeight:'800',fontSize:13}}>{miles}</Text><Text style={{color:radius===miles?'#34302A':colors.muted,fontSize:9,fontWeight:'700'}}>MI</Text>
          </Pressable>)}
        </View>
      </View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search venues or towns" placeholderTextColor={colors.muted} style={{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:14,color:colors.text,marginBottom:12}}/>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12}}>
        {filters.map(f=><Pressable key={f.value} onPress={()=>setCategory(f.value)} style={{paddingHorizontal:12,paddingVertical:8,borderRadius:20,backgroundColor:category===f.value?colors.accent:colors.panel,borderWidth:1,borderColor:category===f.value?colors.accent:colors.border}}>
          <Text style={{color:category===f.value?'#111820':colors.text,fontSize:11,fontWeight:'700'}}>{f.label}</Text>
        </Pressable>)}
      </View>
      {error?<Text style={{color:'#E6A18F',fontSize:12,marginBottom:12}}>{error}</Text>:null}
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:8,marginBottom:10}}>
        <Text style={{color:colors.text,fontWeight:'800',fontSize:16}}>VENUES NEAR YOU</Text>
        <Text style={{color:colors.muted,fontSize:11}}>{loading?'Searching…':filtered.length+' results'}</Text>
      </View>
      {loading?<ActivityIndicator color={colors.accent} style={{padding:24}}/>:null}
      {!loading&&filtered.length===0&&!error?<View style={{padding:18,borderRadius:14,backgroundColor:colors.panel}}><Text style={{color:colors.text,fontWeight:'700'}}>No venues found yet.</Text><Text style={{color:colors.muted,fontSize:12,lineHeight:19,marginTop:6}}>The Atlas directory is still being populated. The map and location are ready; venue ingestion is the next step.</Text></View>:null}
      {filtered.map(v=><View key={v.id} style={{padding:15,marginBottom:9,borderRadius:15,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',gap:12}}>
          <View style={{flex:1}}>
            <Text style={{color:colors.text,fontSize:15,fontWeight:'800'}}>{v.name}</Text>
            <Text style={{color:colors.accent,fontSize:10,fontWeight:'800',textTransform:'uppercase',letterSpacing:1,marginTop:5}}>{v.venue_type.replace('_',' ')}</Text>
            <Text style={{color:colors.muted,fontSize:11,marginTop:5}}>{[v.locality,v.region].filter(Boolean).join(', ')||v.address_line||'Address not available'}</Text>
          </View>
          <View style={{alignItems:'flex-end'}}><Text style={{color:colors.text,fontWeight:'800'}}>{v.distance_miles.toFixed(1)} mi</Text><Text style={{color:colors.muted,fontSize:9,marginTop:4}}>{v.verification_status.replace('_',' ')}</Text></View>
        </View>
        <Pressable onPress={()=>openMap(v)} style={{alignSelf:'flex-start',paddingVertical:9,marginTop:7}}><Text style={{color:colors.accent,fontSize:11,fontWeight:'800'}}>OPEN IN MAP ↗</Text></Pressable>
      </View>)}
    </>}
    <Text style={styles.footnote}>Map data © OpenStreetMap contributors. Your precise location is used only for this search session and is not stored in the venue directory.</Text>
  </Screen>;
}
