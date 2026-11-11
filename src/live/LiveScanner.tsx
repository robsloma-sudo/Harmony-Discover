import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { router } from 'expo-router';
import { readLiveFrame, saveBottleSightings, bottleErrorMessage, type BottleRead, type MenuGlimpse } from '../services/discoverLiveApi';
import { useScan } from '../state/ScanContext';

type PhotoState = { status: 'reading' | 'done' | 'error'; bottles: BottleRead[]; menu: MenuGlimpse | null; note: string };
const EMPTY: PhotoState = { status: 'reading', bottles: [], menu: null, note: '' };
const C = { bg:'#050A1C',line:'rgba(79,139,255,.45)',blue:'#4F8BFF',text:'#F2F8FF',muted:'#B8CBE8',brass:'#D8B878',green:'#7DFFB5',amber:'#FFD27A' };
const CATEGORY: Record<string,string> = { tequila:'Tequila',mezcal:'Mezcal',whiskey:'Whiskey',vodka:'Vodka',gin:'Gin',rum:'Rum',brandy:'Brandy',liqueur:'Liqueur',amaro_aperitivo:'Amaro / aperitivo',vermouth:'Vermouth',wine:'Wine',sparkling:'Sparkling wine',beer:'Beer',cider:'Cider',non_alcoholic:'Non-alcoholic',other:'Other' };
const clean = (v: unknown) => Array.isArray(v) ? v.join(', ') : String(v || '');
const nameOf = (b: BottleRead) => [b.match?.brand || b.brand,b.product].filter(Boolean).join(' ');
const keyOf = (b: BottleRead) => nameOf(b).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function factsOf(b: BottleRead): Array<[string,string]> {
 const d=b.details||{};
 const rows: Array<[string,string]> = [['Brand',b.match?.brand||b.brand],['Expression',b.product],['Type',CATEGORY[b.category]||''],['Producer',clean(d.producer)],['Vintage',clean(d.vintage)],['Appellation',clean(d.appellation)],['Region',clean(d.region)||b.origin||clean(d.country)],['Grapes',clean(d.grapes)],['Class',clean(d.classification)],['Age',clean(d.age_statement)],['Finish',clean(d.cask_finish)],['Flavour',clean(d.flavor)],['Strength',b.proof],['Size',b.size],['Batch',clean(d.batch)],['Certified',clean(d.certifications)]];
 return rows.filter(([,v])=>!!v).slice(0,12);
}
function makeSession() {
 try { if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
 return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r.toString(16):(r&3|8).toString(16));});
}
function Photo({uri,state,onPress}:{uri:string;state:PhotoState;onPress:()=>void}) {
 const sweep=useRef(new Animated.Value(0)).current;
 const [frame,setFrame]=useState({width:0,height:0});
 const [imageSize,setImageSize]=useState({width:0,height:0});
 useEffect(()=>{let alive=true;Image.getSize(uri,(width,height)=>{if(alive)setImageSize({width,height});},()=>undefined);return()=>{alive=false;};},[uri]);
 const scale=imageSize.width&&imageSize.height&&frame.width&&frame.height?Math.min(frame.width/imageSize.width,frame.height/imageSize.height):0;
 const renderedWidth=imageSize.width*scale, renderedHeight=imageSize.height*scale;
 const offsetX=(frame.width-renderedWidth)/2, offsetY=(frame.height-renderedHeight)/2;
 useEffect(()=>{
  if(state.status!=='reading') return;
  sweep.setValue(0);
  const loop=Animated.loop(Animated.sequence([Animated.timing(sweep,{toValue:1,duration:2200,useNativeDriver:true}),Animated.timing(sweep,{toValue:0,duration:2200,useNativeDriver:true})]));
  loop.start();return()=>loop.stop();
 },[state.status,sweep]);
 const translateY=sweep.interpolate({inputRange:[0,1],outputRange:[0,260]});
 return <Pressable onLayout={event=>setFrame({width:event.nativeEvent.layout.width,height:event.nativeEvent.layout.height})} onPress={onPress} style={s.photo}>
  <Image source={{uri}} resizeMode="contain" style={StyleSheet.absoluteFill}/>
  <View pointerEvents="none" style={s.tint}/>
  <Animated.View pointerEvents="none" style={[s.sweep,{transform:[{translateY}]}]}/>
  {scale>0&&state.bottles.map((b,i)=>{const x0=Math.max(0,Math.min(1,b.box.x0)),y0=Math.max(0,Math.min(1,b.box.y0)),x1=Math.max(x0,Math.min(1,b.box.x1)),y1=Math.max(y0,Math.min(1,b.box.y1));return <View key={keyOf(b)+i} pointerEvents="none" style={[s.box,{left:offsetX+x0*renderedWidth,top:offsetY+y0*renderedHeight,width:Math.max(18,(x1-x0)*renderedWidth),height:Math.max(24,(y1-y0)*renderedHeight),borderColor:b.state==='unsure'?C.amber:C.blue}]}><Text numberOfLines={1} style={[s.tagText,b.state==='unsure'&&{color:C.amber}]}>{b.state==='unsure'?'CHECK':nameOf(b)||'Bottle'}</Text></View>;})}
  <View style={s.photoStatus}>{state.status==='reading'?<><ActivityIndicator size="small" color={C.blue}/><Text style={s.statusText}>READING LABELS</Text></>:<Text style={s.statusText}>{state.status==='error'?'READ FAILED':state.menu?'MENU FOUND':state.bottles.length+' BOTTLES FOUND'}</Text>}</View>
 </Pressable>;
}
export default function LiveScanner({photos,onClose,source='camera'}:{photos:string[];onClose:()=>void;source?:'camera'|'gallery'}) {
 const uris=useMemo(()=>photos.slice(0,6),[photos]);
 const {addPages}=useScan();
 const session=useMemo(()=>makeSession(),[]);
 const [states,setStates]=useState<PhotoState[]>(()=>uris.map(()=>EMPTY));
 const [active,setActive]=useState(0);
 const [review,setReview]=useState(false);
 const [venue,setVenue]=useState('');
 const [saving,setSaving]=useState(false);
 const [note,setNote]=useState('');
 const [removed,setRemoved]=useState<Record<string,boolean>>({});
 const [accepted,setAccepted]=useState<Record<string,boolean>>({});
 const [selectedKey,setSelectedKey]=useState<string>('');
 const started=useRef<Record<number,boolean>>({});
 const patch=(i:number,next:Partial<PhotoState>)=>setStates(old=>old.map((x,k)=>k===i?{...x,...next}:x));
 useEffect(()=>{
  let alive=true;
  uris.forEach((uri,i)=>{
   if(started.current[i]) return; started.current[i]=true;
   void (async()=>{
    try {
     const resized=await ImageManipulator.manipulateAsync(uri,[{resize:{width:1100}}],{compress:0.76,format:ImageManipulator.SaveFormat.JPEG,base64:true});
     if(!alive)return;
     if(!resized.base64)throw new Error('image_conversion_failed');
     if(i>0)await new Promise(resolve=>setTimeout(resolve,i*500));
     const result=await readLiveFrame(resized.base64);
     if(alive)patch(i,{status:'done',bottles:result.bottles,menu:result.menu.visible?result.menu:null});
    } catch(error) {if(alive)patch(i,{status:'error',note:bottleErrorMessage(error)});}
   })();
  });
  return()=>{alive=false;};
 },[uris]);
 const all=states.flatMap(x=>x.bottles);
 const tally=useMemo(()=>{
  const map:Record<string,BottleRead>={};
  all.forEach(b=>{const k=keyOf(b);if((b.state!=='unsure'||accepted[k])&&k&&!removed[k])map[k]=b;});
  return Object.values(map);
 },[states,removed,accepted]);
 const menuPages=uris.filter((_,i)=>!!states[i]?.menu);
 const menuItems=states.reduce((n,x)=>n+(x.menu?.items.length||0),0);
 const current=states[active]||EMPTY;
 const focus=current.bottles.find(b=>keyOf(b)===selectedKey)||current.bottles.filter(b=>b.state!=='unsure').sort((a,b)=>Math.abs((a.box.x0+a.box.x1)/2-.5)-Math.abs((b.box.x0+b.box.x1)/2-.5))[0]||current.bottles[0];
 const reviewList=useMemo(()=>{const map:Record<string,BottleRead>={};all.forEach(b=>{const k=keyOf(b);if(k&&!removed[k])map[k]=b;});return Object.values(map);},[states,removed]);
 const facts=focus?factsOf(focus):(current.menu?.items.slice(0,10).map(x=>[x.price||x.type,x.name] as [string,string])||[]);
 const reading=states.filter(x=>x.status==='reading').length;
 async function retryPhoto(index:number){
  const uri=uris[index];if(!uri)return;patch(index,{status:'reading',note:'',bottles:[],menu:null});
  try{const resized=await ImageManipulator.manipulateAsync(uri,[{resize:{width:1100}}],{compress:0.82,format:ImageManipulator.SaveFormat.JPEG,base64:true});if(!resized.base64)throw new Error('image_conversion_failed');const result=await readLiveFrame(resized.base64);patch(index,{status:'done',bottles:result.bottles,menu:result.menu.visible?result.menu:null});}
  catch(error){patch(index,{status:'error',note:bottleErrorMessage(error)});}
 }
 function openJourney(b:BottleRead){router.push({pathname:'/journey',params:{source:'discover',entityType:'product',title:nameOf(b),brand:b.match?.brand||b.brand,expression:b.product,category:CATEGORY[b.category]||b.category,proof:b.proof,size:b.size}});}
 async function save(){
  if(!tally.length||saving)return;setSaving(true);setNote('');
  try{const result=await saveBottleSightings(session,venue.trim(),tally);setNote('Saved '+result.saved+' bottle'+(result.saved===1?'':'s')+' privately to Discover. Not published to Harmony.');setReview(false);setRemoved(old=>({...old,...Object.fromEntries(tally.map(b=>[keyOf(b),true]))}));}
  catch(error){setNote(bottleErrorMessage(error));}finally{setSaving(false);}
 }
 function keepMenu(){if(!menuPages.length)return;addPages(uris,source);router.push('/preview');}
 return <View style={s.root}>
  <View style={s.header}>
   <Pressable onPress={()=>{if(uris.length>1&&active!==-1)setActive(-1);else onClose();}}><Text style={s.back}>‹ {uris.length>1&&active!==-1?'ALL PHOTOS':'SCAN AGAIN'}</Text></Pressable>
   <View style={s.headerCenter}><Text style={s.kicker}>HARMONY DISCOVER</Text><Text style={s.headline}>{reading?'READING '+reading+' OF '+uris.length:'SCAN COMPLETE'}</Text></View><View style={{width:78}}/>
  </View>
  {active===-1&&uris.length>1?<View style={s.grid}>{uris.map((uri,i)=><View key={uri+i} style={s.gridCell}><Photo uri={uri} state={states[i]||EMPTY} onPress={()=>setActive(i)}/></View>)}</View>:<>
   <View style={s.hero}><Photo uri={uris[active]||uris[0]} state={current} onPress={()=>{}}/></View>
   {uris.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs}>{uris.map((uri,i)=><Pressable key={uri+i} onPress={()=>setActive(i)} style={[s.thumb,i===active&&s.thumbOn]}><Image source={{uri}} style={s.thumbImage}/><Text style={s.thumbLabel}>{i+1}</Text></Pressable>)}</ScrollView>}
   <ScrollView style={s.details} contentContainerStyle={s.detailsContent}>
    {focus?<><Text style={s.product}>{nameOf(focus)||'Bottle read'}</Text><Text style={[s.match,focus.state==='matched'?{color:C.green}:{color:C.muted}]}>{focus.state==='matched'?'✓ CATALOG LINK · VERIFY DETAILS':focus.state==='unsure'?'POSSIBLE BOTTLE · NEEDS REVIEW':'READ FROM LABEL · NOT CONFIRMED'}</Text></>:current.menu?<><Text style={s.product}>{current.menu.title||'Menu detected'}</Text><Text style={s.match}>{current.menu.items.length+' MENU ITEMS FOUND'}</Text></>:<Text style={s.empty}>{current.status==='reading'?'Tracing label edges and reading printed text…':current.status==='error'?current.note:'No clearly readable bottle or menu on this photo.'}</Text>}
    {current.bottles.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bottleChoices}>{current.bottles.map((b,i)=><Pressable key={keyOf(b)+i} onPress={()=>setSelectedKey(keyOf(b))} style={[s.bottleChoice,keyOf(b)===keyOf(focus||({brand:'',product:''} as BottleRead))&&s.bottleChoiceActive]}><Text numberOfLines={1} style={s.bottleChoiceText}>{nameOf(b)||'Bottle '+(i+1)}</Text></Pressable>)}</ScrollView>}
    <View style={s.factGrid}>{facts.map(([label,value],i)=><View key={label+i} style={s.fact}><Text style={s.factLabel}>{label.toUpperCase()}</Text><Text style={s.factValue}>{value}</Text></View>)}</View>
    {(current.status==='error'||(current.status==='done'&&!focus&&!current.menu))&&<Pressable onPress={()=>void retryPhoto(active)} style={s.secondaryAction}><Text style={s.actionText}>RETRY THIS PHOTO</Text></Pressable>}
    {!!focus&&<Pressable onPress={()=>openJourney(focus)} style={s.journeyAction}><Text style={s.journeyActionText}>EXPLORE THIS PRODUCT IN JOURNEYS</Text></Pressable>}
   </ScrollView>
  </>}
  {!!note&&<Text style={s.note}>{note}</Text>}
  <View style={s.footer}><Text style={s.tally}>{tally.length+' BOTTLES · '+all.filter(b=>b.state==='unsure').length+' UNSURE · '+menuItems+' MENU ITEMS'}</Text>
   <View style={s.actions}>{menuPages.length>0&&<Pressable onPress={keepMenu} style={s.textAction}><Text style={s.actionText}>KEEP MENU</Text></Pressable>}{reviewList.length>0&&<Pressable onPress={()=>setReview(true)} style={s.saveButton}><Text style={s.saveText}>REVIEW {reviewList.length} BOTTLES</Text></Pressable>}</View>
  </View>
  {review&&<View style={s.reviewOverlay}><View style={s.reviewHeader}><Text style={s.reviewTitle}>BOTTLES READ</Text><Pressable onPress={()=>setReview(false)}><Text style={s.back}>BACK</Text></Pressable></View>
   <Text style={s.reviewNotice}>These sightings are private to your Discover account. They are not published to Harmony Core or Harmony Journeys.</Text>
   <ScrollView style={{flex:1}}>{reviewList.map(b=>{const k=keyOf(b),needsReview=b.state==='unsure'&&!accepted[k];return <View key={k} style={s.reviewRow}><View style={{flex:1}}><Text style={s.reviewName}>{nameOf(b)||'Unidentified bottle'}</Text><Text style={s.reviewMeta}>{[CATEGORY[b.category],clean(b.details?.vintage),clean(b.details?.classification),b.proof].filter(Boolean).join(' · ')}</Text><Text style={[s.reviewMeta,needsReview&&{color:C.amber}]}>{needsReview?'UNSURE · CONFIRM BEFORE SAVING':accepted[k]?'USER CONFIRMED':b.state==='matched'?'CATALOG LINK FOUND':'LABEL READ'}</Text></View>{needsReview?<Pressable onPress={()=>setAccepted(old=>({...old,[k]:true}))} style={s.keepButton}><Text style={s.keepText}>KEEP</Text></Pressable>:<Pressable onPress={()=>setRemoved(old=>({...old,[k]:true}))}><Text style={s.remove}>×</Text></Pressable>}</View>;})}</ScrollView>
   <TextInput value={venue} onChangeText={setVenue} placeholder="Venue (optional)" placeholderTextColor="#8093B5" style={s.venue}/>
   <Pressable onPress={save} disabled={!tally.length||saving} style={[s.saveButton,{alignSelf:'stretch',alignItems:'center',opacity:!tally.length||saving?0.45:1}]}>{saving?<ActivityIndicator color="#07101F"/>:<Text style={s.saveText}>SAVE {tally.length} SIGHTINGS</Text>}</Pressable>
  </View>}
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg,paddingTop:8},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:C.line},back:{color:C.blue,fontSize:11,fontWeight:'900',letterSpacing:1.2},headerCenter:{alignItems:'center'},kicker:{color:C.brass,fontSize:8,fontWeight:'900',letterSpacing:2},headline:{color:C.text,fontSize:12,fontWeight:'900',letterSpacing:1.4,marginTop:4},
 hero:{flex:1,minHeight:180,padding:12},photo:{flex:1,width:'100%',height:'100%',overflow:'hidden',borderWidth:1,borderColor:C.line,borderRadius:14,backgroundColor:'#091126'},box:{position:'absolute',borderWidth:1.5,borderRadius:5,backgroundColor:'rgba(4,12,42,.08)'},tint:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(4,12,42,.22)'},sweep:{position:'absolute',left:0,right:0,top:0,height:3,backgroundColor:'#DCEBFF',shadowColor:C.blue,shadowOpacity:1,shadowRadius:12,elevation:9},tag:{position:'absolute',maxWidth:'80%',transform:[{translateX:-40}],paddingHorizontal:8,paddingVertical:4,backgroundColor:'rgba(5,10,28,.85)',borderRadius:6,borderWidth:1,borderColor:C.line},tagText:{color:C.text,fontSize:10,fontWeight:'800',textShadowColor:C.blue,textShadowRadius:8},photoStatus:{position:'absolute',left:10,right:10,bottom:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'rgba(5,10,28,.82)',padding:7,borderRadius:8},statusText:{color:C.text,fontSize:9,fontWeight:'900',letterSpacing:1},
 bottleChoices:{gap:7,marginTop:12},bottleChoice:{paddingHorizontal:10,paddingVertical:8,borderRadius:16,borderWidth:1,borderColor:C.line},bottleChoiceActive:{borderColor:C.brass,backgroundColor:'rgba(216,184,120,.12)'},bottleChoiceText:{color:C.text,fontSize:10,fontWeight:'700'},thumbs:{paddingHorizontal:12,paddingBottom:8,gap:8},thumb:{width:56,height:66,borderWidth:1,borderColor:C.line,borderRadius:8,overflow:'hidden'},thumbOn:{borderColor:C.blue,borderWidth:2},thumbImage:{width:'100%',height:46},thumbLabel:{color:C.muted,textAlign:'center',fontSize:9,paddingTop:2},
 details:{maxHeight:220,borderTopWidth:1,borderTopColor:C.line},detailsContent:{padding:16},product:{color:C.text,fontSize:23,fontWeight:'900',textShadowColor:C.blue,textShadowRadius:10},match:{color:C.green,fontSize:9,fontWeight:'900',letterSpacing:1.2,marginTop:5},empty:{color:C.muted,fontSize:12,lineHeight:18},factGrid:{flexDirection:'row',flexWrap:'wrap',gap:12,marginTop:14},fact:{width:'46%',minHeight:40},factLabel:{color:C.blue,fontSize:8,fontWeight:'900',letterSpacing:1},factValue:{color:C.text,fontSize:12,fontWeight:'700',marginTop:3},
 note:{color:C.green,fontSize:11,textAlign:'center',paddingVertical:6},secondaryAction:{alignSelf:'flex-start',marginTop:14,paddingVertical:10,paddingHorizontal:13,borderWidth:1,borderColor:C.line,borderRadius:8},journeyAction:{marginTop:14,paddingVertical:13,paddingHorizontal:14,borderRadius:8,backgroundColor:C.brass,alignItems:'center'},journeyActionText:{color:'#07101F',fontSize:10,fontWeight:'900',letterSpacing:1},reviewNotice:{color:C.muted,fontSize:11,lineHeight:16,marginBottom:12},keepButton:{paddingHorizontal:12,paddingVertical:8,borderRadius:7,backgroundColor:C.brass},keepText:{color:'#07101F',fontSize:9,fontWeight:'900',letterSpacing:1},footer:{paddingHorizontal:16,paddingTop:10,paddingBottom:24,borderTopWidth:1,borderTopColor:C.line},tally:{color:C.muted,fontSize:9,fontWeight:'900',letterSpacing:1.1},actions:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:8},textAction:{paddingVertical:10},actionText:{color:C.text,fontSize:12,fontWeight:'900',letterSpacing:1},saveButton:{backgroundColor:C.blue,paddingVertical:12,paddingHorizontal:16,borderRadius:8},saveText:{color:'#061020',fontSize:10,fontWeight:'900',letterSpacing:1},
 reviewOverlay:{...StyleSheet.absoluteFillObject,backgroundColor:'#061024',padding:20,paddingTop:44},reviewHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:18},reviewTitle:{color:C.text,fontSize:22,fontWeight:'900'},reviewRow:{flexDirection:'row',alignItems:'center',paddingVertical:13,borderBottomWidth:1,borderBottomColor:C.line},reviewName:{color:C.text,fontSize:14,fontWeight:'800'},reviewMeta:{color:C.muted,fontSize:10,marginTop:4},remove:{color:C.amber,fontSize:26,paddingHorizontal:10},venue:{color:C.text,borderBottomWidth:1,borderBottomColor:C.blue,paddingVertical:12,marginBottom:14},
 grid:{flex:1,flexDirection:'row',flexWrap:'wrap',gap:8,padding:10,alignContent:'flex-start'},gridCell:{width:'48%',height:210}
});
