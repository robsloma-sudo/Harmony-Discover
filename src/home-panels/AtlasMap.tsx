import React, { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, Text, View } from 'react-native';

type Point = { latitude: number; longitude: number };
type VenuePin = Point & { id: string; name: string };

const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;
const clamp = (v:number,min:number,max:number) => Math.max(min,Math.min(max,v));
const wrap = (v:number,n:number) => ((v % n) + n) % n;

export function projectMercator(point:Point, zoom:number) {
  const world = TILE_SIZE * Math.pow(2, zoom);
  const latitude = clamp(point.latitude, -MAX_LAT, MAX_LAT) * Math.PI / 180;
  return {
    x: (point.longitude + 180) / 360 * world,
    y: (1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2 * world,
  };
}

export function unprojectMercator(pixel:Point, zoom:number):Point {
  const world = TILE_SIZE * Math.pow(2, zoom);
  const longitude = pixel.longitude / world * 360 - 180;
  const n = Math.PI - 2 * Math.PI * pixel.latitude / world;
  return { longitude, latitude: 180 / Math.PI * Math.atan(Math.sinh(n)) };
}

export function AtlasMap({center, venues, onSelectVenue, height=210, fitKey}:{
  center:Point|null; venues:VenuePin[]; onSelectVenue?:(id:string)=>void; height?:number; fitKey?:string;
}) {
  const [size,setSize] = useState({width:0,height});
  const [mapCenter,setMapCenter] = useState<Point>(center || {latitude:39.5,longitude:-98.35});
  const [zoom,setZoom] = useState(4);
  const [drag,setDrag] = useState({x:0,y:0});
  const dragRef = useRef({x:0,y:0});
  const centerRef = useRef(mapCenter);
  centerRef.current = mapCenter;

  React.useEffect(()=>{ if(center){setMapCenter(center);setZoom(12);} },[center?.latitude,center?.longitude]);

  // Reframe the map after a radius/search result settles: fit the user's position
  // and every returned venue, using the highest zoom that keeps all pins visible.
  React.useEffect(()=>{
    if(!center||size.width<1||size.height<1)return;
    const points:Point[]=[center,...venues];
    if(points.length===1){setMapCenter(center);setZoom(14);return;}
    const projected=points.map(p=>projectMercator(p,0));
    const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y);
    const spanX=Math.max(0.00001,Math.max(...xs)-Math.min(...xs));
    const spanY=Math.max(0.00001,Math.max(...ys)-Math.min(...ys));
    const usableW=Math.max(80,size.width-76),usableH=Math.max(80,size.height-76);
    const fitted=clamp(Math.floor(Math.min(Math.log2(usableW/spanX),Math.log2(usableH/spanY))),2,17);
    const mid=unprojectMercator({longitude:(Math.min(...xs)+Math.max(...xs))/2,latitude:(Math.min(...ys)+Math.max(...ys))/2},0);
    setMapCenter(mid);setZoom(fitted);
  },[fitKey,center?.latitude,center?.longitude,size.width,size.height]);

  const responder = useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>false,
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>4||Math.abs(g.dy)>4,
    onPanResponderGrant:()=>{dragRef.current={x:0,y:0};setDrag({x:0,y:0});},
    onPanResponderMove:(_,g)=>{dragRef.current={x:g.dx,y:g.dy};setDrag({x:g.dx,y:g.dy});},
    onPanResponderRelease:(_,g)=>{
      const p=projectMercator(centerRef.current,zoom);
      setMapCenter(unprojectMercator({latitude:p.y-g.dy,longitude:p.x-g.dx},zoom));
      dragRef.current={x:0,y:0};setDrag({x:0,y:0});
    },
    onPanResponderTerminate:()=>{dragRef.current={x:0,y:0};setDrag({x:0,y:0});},
  }),[zoom]);

  const tiles = useMemo(()=>{
    if(size.width<1)return [];
    const c=projectMercator(mapCenter,zoom);
    const cx=Math.floor(c.x/TILE_SIZE), cy=Math.floor(c.y/TILE_SIZE), count=Math.pow(2,zoom);
    const cols=Math.ceil(size.width/TILE_SIZE)+3, rows=Math.ceil(size.height/TILE_SIZE)+3;
    const result:Array<{key:string;uri:string;left:number;top:number}>=[];
    for(let dy=-Math.ceil(rows/2);dy<=Math.ceil(rows/2);dy++)for(let dx=-Math.ceil(cols/2);dx<=Math.ceil(cols/2);dx++){
      const tx=cx+dx,ty=cy+dy;
      if(ty<0||ty>=count)continue;
      const wrappedX=wrap(tx,count);
      result.push({
        key:zoom+'-'+tx+'-'+ty,
        uri:'https://tile.openstreetmap.org/'+zoom+'/'+wrappedX+'/'+ty+'.png',
        left:size.width/2+(tx*TILE_SIZE-c.x)+drag.x,
        top:size.height/2+(ty*TILE_SIZE-c.y)+drag.y,
      });
    }
    return result;
  },[mapCenter,zoom,size.width,size.height,drag.x,drag.y]);

  const pins = useMemo(()=>{
    if(size.width<1)return [];
    const c=projectMercator(mapCenter,zoom);
    return venues.map(v=>{
      const p=projectMercator(v,zoom);
      return {...v,left:size.width/2+(p.x-c.x)+drag.x,top:size.height/2+(p.y-c.y)+drag.y};
    }).filter(p=>p.left>-18&&p.left<size.width+18&&p.top>-18&&p.top<size.height+18);
  },[venues,mapCenter,zoom,size.width,size.height,drag.x,drag.y]);

  return <View onLayout={e=>setSize({width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height})}
    style={{height,width:'100%',borderRadius:14,overflow:'hidden',backgroundColor:'#071326',borderWidth:1,borderColor:'rgba(54,123,255,0.42)'}}>
    <View style={{position:'absolute',left:0,right:0,top:0,bottom:0}} {...responder.panHandlers}>
      {tiles.map(t=><Image key={t.key} source={{uri:t.uri}} resizeMode="stretch" style={{position:'absolute',left:t.left,top:t.top,width:TILE_SIZE,height:TILE_SIZE}} />)}
      <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(4,13,35,0.34)'}}/>
      {pins.map(pin=><Pressable key={pin.id} onPress={()=>onSelectVenue?.(pin.id)} style={{position:'absolute',left:pin.left-8,top:pin.top-8,width:16,height:16,borderRadius:8,backgroundColor:'#3B82F6',borderWidth:2,borderColor:'#DCEBFF',shadowColor:'#287BFF',shadowOpacity:0.95,shadowRadius:9,elevation:8}} />)}
      {center&&<View pointerEvents="none" style={{position:'absolute',left:size.width/2-7,top:size.height/2-7,width:14,height:14,borderRadius:7,backgroundColor:'#58A6FF',borderWidth:2,borderColor:'#EAF4FF',shadowColor:'#318BFF',shadowOpacity:1,shadowRadius:12,elevation:9}}/>}
    </View>
    <View pointerEvents="box-none" style={{position:'absolute',right:9,top:9,gap:6}}>
      <Pressable onPress={()=>setZoom(z=>clamp(z+1,2,18))} style={{width:32,height:32,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(5,15,32,0.92)',borderWidth:1,borderColor:'rgba(91,155,255,0.7)'}}><Text style={{color:'#EAF4FF',fontSize:20,fontWeight:'700'}}>+</Text></Pressable>
      <Pressable onPress={()=>setZoom(z=>clamp(z-1,2,18))} style={{width:32,height:32,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(5,15,32,0.92)',borderWidth:1,borderColor:'rgba(91,155,255,0.7)'}}><Text style={{color:'#EAF4FF',fontSize:20,fontWeight:'700'}}>−</Text></Pressable>
      <Pressable onPress={()=>{if(center){setMapCenter(center);setZoom(12);}else{setMapCenter({latitude:39.5,longitude:-98.35});setZoom(4);}}} style={{width:32,height:32,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(5,15,32,0.92)',borderWidth:1,borderColor:'rgba(91,155,255,0.7)'}}><Text style={{color:'#8FC2FF',fontSize:13,fontWeight:'900'}}>◎</Text></Pressable>
    </View>
    <View pointerEvents="none" style={{position:'absolute',left:9,bottom:7,paddingHorizontal:7,paddingVertical:4,borderRadius:6,backgroundColor:'rgba(3,9,20,0.76)'}}>
      <Text style={{color:'rgba(220,235,255,0.8)',fontSize:7,letterSpacing:0.4}}>© OpenStreetMap contributors · DRAG TO MOVE</Text>
    </View>
  </View>;
}
