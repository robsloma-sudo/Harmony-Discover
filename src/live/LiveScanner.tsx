import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
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
 const d=b.details||{}, fc=b.fieldConfidence||{};
 const rows: Array<[string,string]> = [
  ['Brand',b.match?.brand||b.brand],['Producer',clean(d.producer)],['Distillery',clean(d.distillery)],['Winery / estate',clean(d.winery)||clean(d.estate)],
  ['Bottler',clean(d.bottler)],['Brand owner',clean(d.brand_owner)],['Product expression',b.product],['Category',CATEGORY[b.category]||b.category],
  ['Class / designation',clean(d.classification)||clean(d.label_designation)],['Style',clean(d.style)],['Subcategory',clean(d.subcategory)],
  ['Origin',b.origin||clean(d.country)],['Region',clean(d.region)],['Subregion / AVA',clean(d.subregion)],['Appellation',clean(d.appellation)],['Appellation level',clean(d.appellation_level)],
  ['Vineyard',clean(d.vineyard)],['Grapes',clean(d.grapes)],['Vintage',clean(d.vintage)],['Harvest',clean(d.harvested_on)],
  ['Proof / ABV',b.proof],['Bottle size',b.size||clean(d.net_contents)||clean(d.package_size)],['Package type',clean(d.package_type)],['Package material',clean(d.package_material)],
  ['SKU',clean(d.sku)],['UPC / EAN',clean(d.upc_ean)],['Age statement',clean(d.age_statement)],['Mash bill',clean(d.mash_bill)],['Grain',clean(d.grain)],['Agave',clean(d.agave_type)],
  ['Production method',clean(d.production_method)],['Distillation',clean(d.distillation)],['Cask type',clean(d.cask_type)],['Cask finish',clean(d.cask_finish)],
  ['Barrel number',clean(d.barrel_number)],['Batch',clean(d.batch)],['Lot code',clean(d.lot_code)],['Distilled on',clean(d.distilled_on)],['Bottled on',clean(d.bottled_on)],
  ['Disgorged on',clean(d.disgorged_on)],['Dosage',clean(d.dosage)],['Residual sugar',clean(d.residual_sugar)],['Flavor',clean(d.flavor)],
  ['Importer',clean(d.importer)],['Certifications',clean(d.certifications)],['Organic claim',clean(d.organic_claim)],['Awards',clean(d.awards)]
 ];
 const aliases:Record<string,string>={brand:'brand','product expression':'product',category:'category','class / designation':'classification','proof / abv':'proof','bottle size':'size',origin:'origin','winery / estate':'winery','subregion / ava':'subregion','appellation level':'appellation_level','age statement':'age_statement','cask finish':'cask_finish','barrel number':'barrel_number','lot code':'lot_code','organic claim':'organic_claim','upc / ean':'upc_ean'};
 const seen=new Set<string>();
 return rows.filter(([label,value])=>{const key=label.toLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true;}).map(([label,value])=>{const field=aliases[label.toLowerCase()]||label.toLowerCase().replace(/[^a-z0-9]+/g,'_');const score=fc[field];return [score===undefined?label:`${label} · ${Math.round(score*100)}%`,value];});
}
const RESEARCH_FIELDS: Array<[string,string]> = [['Exact expression','product'],['SKU','sku'],['UPC / EAN','upc_ean'],['Producer','producer'],['Brand owner','brand_owner'],['Country / region','region'],['Appellation','appellation'],['Grapes / agave / ingredients','grapes'],['Mash bill','mash_bill'],['Production method','production_method'],['Age statement','age_statement'],['Cask / barrel','cask_type'],['Vintage / batch','vintage'],['Proof / ABV','proof'],['Bottle size','size'],['Tasting profile','tasting_notes'],['Certifications','certifications'],['Awards','awards']];
function researchValue(b:BottleRead,key:string):string { const d=b.details||{}; const aliases:Record<string,unknown>={product:b.product,proof:b.proof,size:b.size,region:d.region||d.subregion||d.country,grapes:d.grapes||d.agave_type||d.ingredients,vintage:d.vintage||d.batch}; const v=aliases[key]??d[key]; return Array.isArray(v)?v.join(', '):String(v||''); }
function makeSession() {
 try { if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
 return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r.toString(16):(r&3|8).toString(16));});
}
function Photo({uri,state,onPress,animate=false,onSequenceComplete}:{uri:string;state:PhotoState;onPress:()=>void;animate?:boolean;onSequenceComplete?:()=>void}) {
 const progress=useRef(new Animated.Value(0)).current;
 const waitingSweep=useRef(new Animated.Value(0)).current;
 const [stage,setStage]=useState(0);
 const [sequenceDone,setSequenceDone]=useState(false);
 const onCompleteRef=useRef(onSequenceComplete);
 useEffect(()=>{onCompleteRef.current=onSequenceComplete;},[onSequenceComplete]);
 // Keep the scanner visibly working while the image is being analyzed.
 // Previously no animation appeared until OCR returned, making the scan look stalled.
 useEffect(()=>{
  if(!animate||state.status!=='reading'||sequenceDone)return;
  waitingSweep.setValue(0);
  const loop=Animated.loop(Animated.sequence([
   Animated.timing(waitingSweep,{toValue:1,duration:1150,useNativeDriver:true}),
   Animated.timing(waitingSweep,{toValue:0,duration:1150,useNativeDriver:true}),
  ]));
  loop.start();
  return()=>loop.stop();
 },[animate,state.status,sequenceDone,waitingSweep]);
 useEffect(()=>{
  if(!animate||state.status==='error'||(!state.bottles.length&&!state.menu)||sequenceDone)return;
  let alive=true;
  const run=(duration:number)=>new Promise<void>(resolve=>{
   progress.setValue(0);
   Animated.timing(progress,{toValue:1,duration,useNativeDriver:true}).start(({finished})=>resolve());
  });
  void(async()=>{
   setStage(1);await run(1450);if(!alive)return;
   setStage(2);await run(1350);if(!alive)return;
   setStage(3);await run(900);if(!alive)return;
   setSequenceDone(true);onCompleteRef.current?.();
  })();
  return()=>{alive=false;progress.stopAnimation();};
 },[animate,state.status,state.bottles.length,Boolean(state.menu),sequenceDone,progress]);
 const glow=progress.interpolate({inputRange:[0,1],outputRange:[0.15,1]});
 const drawScale=progress.interpolate({inputRange:[0,1],outputRange:[0.72,1]});
 const primary=state.bottles[0];
 const x0=primary?Math.max(0,Math.min(1,primary.box.x0)):0.25;
 const y0=primary?Math.max(0,Math.min(1,primary.box.y0)):0.12;
 const width=primary?Math.max(.08,Math.min(1-x0,primary.box.x1-primary.box.x0)):.5;
 const height=primary?Math.max(.12,Math.min(1-y0,primary.box.y1-primary.box.y0)):.72;
 const bottleFrame={left:(x0*100)+'%',top:(y0*100)+'%',width:(width*100)+'%',height:(height*100)+'%'};
 const waitingForRead=animate&&state.status==='reading'&&!sequenceDone;
 const waitingBeamY=waitingSweep.interpolate({inputRange:[0,1],outputRange:[0,260]});
 const showTrace=animate&&!sequenceDone&&stage>0&&state.bottles.length>0;
 const showLabel=showTrace&&stage===2;
 const showPrint=showTrace&&stage===3;
 const revealResults=!animate||sequenceDone;
 return <Pressable onPress={onPress} style={s.photo}>
  <Image source={{uri}} resizeMode="contain" style={StyleSheet.absoluteFill}/>
  <View pointerEvents="none" style={s.tint}/>
  {waitingForRead&&<Animated.View pointerEvents="none" style={[s.waitingBeam,{transform:[{translateY:waitingBeamY}]}]}/>}
  {showTrace&&<>
   <View pointerEvents="none" style={[s.bottleTrace,bottleFrame]}>
    <Animated.View style={[s.traceNeckTop,{opacity:progress.interpolate({inputRange:[0,.10,.18,1],outputRange:[0,0,1,1]})}]}/>
    <Animated.View style={[s.traceNeckLeft,{transform:[{scaleY:progress.interpolate({inputRange:[0,.08,.20,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceNeckRight,{transform:[{scaleY:progress.interpolate({inputRange:[0,.08,.20,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceShoulderLeft,{transform:[{scaleX:progress.interpolate({inputRange:[0,.18,.36,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceShoulderRight,{transform:[{scaleX:progress.interpolate({inputRange:[0,.30,.48,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceBodyLeft,{transform:[{scaleY:progress.interpolate({inputRange:[0,.38,.62,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceBodyRight,{transform:[{scaleY:progress.interpolate({inputRange:[0,.50,.74,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.traceBase,{transform:[{scaleX:progress.interpolate({inputRange:[0,.68,.88,1],outputRange:[0,0,1,1]})}]}]}/>
   </View>
   {showLabel&&<View pointerEvents="none" style={[s.labelTrace,{left:(x0*100+width*18)+'%',top:(y0*100+height*39)+'%',width:(width*64)+'%',height:(height*31)+'%'}]}>
    <Animated.View style={[s.labelTop,{transform:[{scaleX:progress.interpolate({inputRange:[0,.05,.30,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.labelRight,{transform:[{scaleY:progress.interpolate({inputRange:[0,.25,.52,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.labelBottom,{transform:[{scaleX:progress.interpolate({inputRange:[0,.48,.76,1],outputRange:[0,0,1,1]})}]}]}/>
    <Animated.View style={[s.labelLeft,{transform:[{scaleY:progress.interpolate({inputRange:[0,.70,.96,1],outputRange:[0,0,1,1]})}]}]}/>
   </View>}
   {showPrint&&<View pointerEvents="none" style={[s.printTrace,{left:(x0*100+width*19)+'%',top:(y0*100+height*43)+'%',width:(width*62)+'%'}]}>
    <Animated.View style={[s.printLine,{opacity:progress.interpolate({inputRange:[0,.10,.34,1],outputRange:[0,0,1,1]})}]}/>
    <Animated.View style={[s.printLine,{opacity:progress.interpolate({inputRange:[0,.36,.62,1],outputRange:[0,0,1,1]})}]}/>
    <Animated.View style={[s.printLine,{opacity:progress.interpolate({inputRange:[0,.64,.90,1],outputRange:[0,0,1,1]})}]}/>
   </View>}
  </>}
  {revealResults&&state.bottles.map((b,i)=><View key={keyOf(b)+i} style={[s.tag,{left:(((b.box.x0+b.box.x1)/2*100)+'%') as `${number}%`,top:(Math.max(8,b.box.y0*100-2)+'%') as `${number}%`}]}><Text numberOfLines={1} style={[s.tagText,b.state==='unsure'&&{color:C.amber}]}>{b.state==='unsure'?'Unsure':nameOf(b)||'Bottle'}</Text></View>)}
  <View style={s.photoStatus}>{state.status==='reading'||(animate&&!sequenceDone)?<><ActivityIndicator size="small" color={C.blue}/><Text style={s.statusText}>{stage===1?'1 · TRACING BOTTLE':stage===2?'2 · TRACING LABEL':stage===3?'3 · READING PRINT':'IDENTIFYING BOTTLE'}</Text></>:<Text style={s.statusText}>{state.status==='error'?'READ FAILED':state.menu?'MENU FOUND':state.bottles.length+' BOTTLES FOUND'}</Text>}</View>
 </Pressable>;
}
export default function LiveScanner({photos,onClose,onKeepMenu,source='camera',mode='auto'}:{photos:string[];onClose:()=>void;onKeepMenu?: (menuPages:string[])=>void;source?:'camera'|'gallery';mode?:'bottle'|'menu'|'auto'}) {
 const uris=useMemo(()=>photos.slice(0,6),[photos]);
 const {addPages}=useScan();
 const session=useMemo(()=>makeSession(),[]);
 const [states,setStates]=useState<PhotoState[]>(()=>uris.map(()=>EMPTY));
 const [active,setActive]=useState(0);
 const [review,setReview]=useState(false);
 const [venue,setVenue]=useState('');
 const [saving,setSaving]=useState(false);
 const [researchComplete,setResearchComplete]=useState(false);
 const [visualComplete,setVisualComplete]=useState<Record<number,boolean>>({});
 const [note,setNote]=useState('');
 const [removed,setRemoved]=useState<Record<string,boolean>>({});
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
  all.forEach(b=>{const k=keyOf(b);if(b.state!=='unsure'&&k&&!removed[k])map[k]=b;});
  return Object.values(map);
 },[states,removed]);
 const menuPages=uris.filter((_,i)=>!!states[i]?.menu);
 const menuItems=states.reduce((n,x)=>n+(x.menu?.items.length||0),0);
 const current=states[active]||EMPTY;
 const focus=current.bottles.filter(b=>b.state!=='unsure').sort((a,b)=>Math.abs((a.box.x0+a.box.x1)/2-.5)-Math.abs((b.box.x0+b.box.x1)/2-.5))[0];
 const facts=focus?factsOf(focus):(current.menu?.items.slice(0,10).map(x=>[x.price||x.type,x.name] as [string,string])||[]);
 const reading=states.filter(x=>x.status==='reading').length;
 async function save(){
  if(!tally.length||saving)return;setSaving(true);setNote('');
  try{const result=await saveBottleSightings(session,venue.trim(),tally);setStates(old=>old.map(photo=>({...photo,bottles:photo.bottles.map(b=>{const x=result.enriched.find(e=>e.brand.trim().toLowerCase()===(b.match?.brand||b.brand).trim().toLowerCase()&&e.product.trim().toLowerCase()===b.product.trim().toLowerCase());return x?{...b,details:{...b.details,...(x.details||{})},fieldConfidence:{...b.fieldConfidence,...(x.fieldConfidence||{})},researchSources:x.researchSources||b.researchSources}:b;})})));setResearchComplete(true);setNote('Saved '+result.saved+' bottle'+(result.saved===1?'':'s')+' · '+result.enriched.reduce((n,b)=>n+Object.keys(b.details||{}).length,0)+' researched fields added');setReview(false);setRemoved(old=>({...old,...Object.fromEntries(tally.map(b=>[keyOf(b),true]))}));}
  catch(error){setNote(bottleErrorMessage(error));}finally{setSaving(false);}
 }
 function keepMenu(){if(!menuPages.length)return;addPages(menuPages,source);onKeepMenu?.(menuPages);}
 return <View style={s.root}>
  <View style={s.header}>
   <Pressable onPress={()=>{if(uris.length>1&&active!==-1)setActive(-1);else onClose();}}><Text style={s.back}>‹ {uris.length>1&&active!==-1?'ALL PHOTOS':'SCAN AGAIN'}</Text></Pressable>
   <View style={s.headerCenter}><Text style={s.kicker}>HARMONY DISCOVER</Text><Text style={s.headline}>{reading?'READING '+reading+' OF '+uris.length:'SCAN COMPLETE'}</Text></View><View style={{width:78}}/>
  </View>
  {active===-1&&uris.length>1?<View style={s.grid}>{uris.map((uri,i)=><View key={uri+i} style={s.gridCell}><Photo uri={uri} state={states[i]||EMPTY} onPress={()=>setActive(i)}/></View>)}</View>:<>
   <View style={s.hero}><Photo key={uris[active]||uris[0]} uri={uris[active]||uris[0]} state={current} onPress={()=>{}} animate onSequenceComplete={()=>setVisualComplete(old=>({...old,[active]:true}))}/></View>
   {uris.length>1&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs}>{uris.map((uri,i)=><Pressable key={uri+i} onPress={()=>setActive(i)} style={[s.thumb,i===active&&s.thumbOn]}><Image source={{uri}} style={s.thumbImage}/><Text style={s.thumbLabel}>{i+1}</Text></Pressable>)}</ScrollView>}
   <ScrollView style={s.details} contentContainerStyle={s.detailsContent}>
    {focus&&visualComplete[active]?<><Text style={s.product}>{nameOf(focus)||'Bottle read'}</Text><Text style={[s.match,focus.state==='matched'?{color:C.green}:{color:C.muted}]}>{focus.state==='matched'?'✓ CATALOG MATCH':'READ FROM LABEL · NOT CONFIRMED'}</Text></> :current.menu&&visualComplete[active]?<><Text style={s.product}>{current.menu.title||'Menu detected'}</Text><Text style={s.match}>{current.menu.items.length+' MENU ITEMS FOUND'}</Text></>:<Text style={s.empty}>{current.status==='reading'?'Tracing the bottle, label and printed text…':current.status==='error'?current.note:'No clearly readable bottle or menu on this photo.'}</Text>}
    {visualComplete[active]&&<View style={s.twoPanels}>
      <View style={s.factPanel}><Text style={s.panelTitle}>DETECTED</Text>{facts.map(([label,value],i)=><View key={label+i} style={s.fact}><Text style={s.factLabel}>{label.toUpperCase()}</Text><Text style={s.factValue}>{value}</Text></View>)}</View>
      {focus&&visualComplete[active]&&<View style={s.researchPanel}><Text style={s.panelTitle}>RESEARCHING</Text><Text style={s.researchHint}>{saving?'SEARCHING TRUSTED SOURCES…':researchComplete?'RESEARCH RESULTS':'SEARCH TARGETS · RUN ON SAVE'}</Text>{RESEARCH_FIELDS.map(([label,key])=>{const value=researchValue(focus,key);const status=value?'FOUND':researchComplete?'NOT FOUND':'QUEUED';return <View key={key} style={s.researchRow}><Text style={s.researchLabel}>{label}</Text><Text style={[s.researchStatus,value?{color:C.green}:researchComplete?{color:C.amber}:{color:C.muted}]}>{status}</Text></View>;})}{(focus.researchSources||[]).length>0&&<><Text style={s.panelTitle}>SOURCES · {focus.researchSources.length}</Text>{focus.researchSources.slice(0,4).map((x,i)=><Text key={x.url||i} style={s.sourceText}>{x.title||x.url}</Text>)}</>}</View>}
     </View>}
   </ScrollView>
  </>}
  {!!note&&<Text style={s.note}>{note}</Text>}
  <View style={s.footer}><Text style={s.tally}>{tally.length+' BOTTLES · '+all.filter(b=>b.state==='unsure').length+' UNSURE · '+menuItems+' MENU ITEMS'}</Text>
   <View style={s.actions}>{menuPages.length>0&&<Pressable onPress={keepMenu} style={s.textAction}><Text style={s.actionText}>KEEP MENU</Text></Pressable>}{tally.length>0&&<Pressable onPress={()=>setReview(true)} style={s.saveButton}><Text style={s.saveText}>REVIEW BOTTLES</Text></Pressable>}</View>
  </View>
  {review&&<View style={s.reviewOverlay}><View style={s.reviewHeader}><Text style={s.reviewTitle}>BOTTLES READ</Text><Pressable onPress={()=>setReview(false)}><Text style={s.back}>BACK</Text></Pressable></View>
   <ScrollView style={{flex:1}}>{tally.map(b=><View key={keyOf(b)} style={s.reviewRow}><View style={{flex:1}}><Text style={s.reviewName}>{nameOf(b)}</Text><Text style={s.reviewMeta}>{[CATEGORY[b.category],clean(b.details?.vintage),clean(b.details?.classification),b.proof].filter(Boolean).join(' · ')}</Text></View><Pressable onPress={()=>setRemoved(old=>({...old,[keyOf(b)]:true}))}><Text style={s.remove}>×</Text></Pressable></View>)}</ScrollView>
   <TextInput value={venue} onChangeText={setVenue} placeholder="Venue (optional)" placeholderTextColor="#8093B5" style={s.venue}/>
   <Pressable onPress={save} disabled={!tally.length||saving} style={[s.saveButton,{alignSelf:'stretch',alignItems:'center',opacity:!tally.length||saving?0.45:1}]}>{saving?<ActivityIndicator color="#07101F"/>:<Text style={s.saveText}>SAVE {tally.length} SIGHTINGS</Text>}</Pressable>
  </View>}
 </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg,paddingTop:8},header:{height:58,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:C.line},back:{color:C.blue,fontSize:11,fontWeight:'900',letterSpacing:1.2},headerCenter:{alignItems:'center'},kicker:{color:C.brass,fontSize:8,fontWeight:'900',letterSpacing:2},headline:{color:C.text,fontSize:12,fontWeight:'900',letterSpacing:1.4,marginTop:4},
 hero:{flex:1,minHeight:180,padding:12},photo:{flex:1,width:'100%',height:'100%',overflow:'hidden',borderWidth:1,borderColor:C.line,borderRadius:14,backgroundColor:'#091126'},tint:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(4,12,42,.12)'},waitingBeam:{position:'absolute',left:0,right:0,top:0,height:2,backgroundColor:'#DDF1FF',shadowColor:'#238BFF',shadowOpacity:1,shadowRadius:14,elevation:10},bottleTrace:{position:'absolute',overflow:'visible'},traceNeckTop:{position:'absolute',top:0,left:'38%',width:'24%',height:2,backgroundColor:'#BCE5FF',shadowColor:'#278BFF',shadowOpacity:1,shadowRadius:9,elevation:8},traceNeckLeft:{position:'absolute',top:0,left:'38%',height:'19%',width:2,backgroundColor:'#A5D7FF',shadowColor:'#278BFF',shadowOpacity:1,shadowRadius:8},traceNeckRight:{position:'absolute',top:0,right:'38%',height:'19%',width:2,backgroundColor:'#A5D7FF',shadowColor:'#278BFF',shadowOpacity:1,shadowRadius:8},traceShoulderLeft:{position:'absolute',top:'18%',left:'8%',width:'30%',height:2,backgroundColor:'#75C2FF',shadowColor:'#278BFF',shadowOpacity:1,shadowRadius:8},traceShoulderRight:{position:'absolute',top:'18%',right:'8%',width:'30%',height:2,backgroundColor:'#75C2FF',shadowColor:'#278BFF',shadowOpacity:1,shadowRadius:8},traceBodyLeft:{position:'absolute',top:'18%',left:'8%',height:'81%',width:2,backgroundColor:'#4F9FFF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:9},traceBodyRight:{position:'absolute',top:'18%',right:'8%',height:'81%',width:2,backgroundColor:'#4F9FFF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:9},traceBase:{position:'absolute',bottom:0,left:'8%',width:'84%',height:2,backgroundColor:'#8BCBFF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:9},labelTrace:{position:'absolute'},labelTop:{position:'absolute',top:0,left:0,right:0,height:2,backgroundColor:'#C5E8FF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:8},labelRight:{position:'absolute',top:0,right:0,bottom:0,width:2,backgroundColor:'#A8D9FF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:8},labelBottom:{position:'absolute',bottom:0,left:0,right:0,height:2,backgroundColor:'#C5E8FF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:8},labelLeft:{position:'absolute',top:0,left:0,bottom:0,width:2,backgroundColor:'#A8D9FF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:8},printTrace:{position:'absolute',gap:5},printLine:{height:2,width:'100%',borderRadius:2,backgroundColor:'#D8EDFF',shadowColor:'#4F9FFF',shadowOpacity:1,shadowRadius:7,elevation:6},tag:{position:'absolute',maxWidth:'80%',transform:[{translateX:-40}],paddingHorizontal:8,paddingVertical:4,backgroundColor:'rgba(5,10,28,.85)',borderRadius:6,borderWidth:1,borderColor:C.line},tagText:{color:C.text,fontSize:10,fontWeight:'800',textShadowColor:C.blue,textShadowRadius:8},photoStatus:{position:'absolute',left:10,right:10,bottom:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'rgba(5,10,28,.82)',padding:7,borderRadius:8},statusText:{color:C.text,fontSize:9,fontWeight:'900',letterSpacing:1},
 thumbs:{paddingHorizontal:12,paddingBottom:8,gap:8},thumb:{width:56,height:66,borderWidth:1,borderColor:C.line,borderRadius:8,overflow:'hidden'},thumbOn:{borderColor:C.blue,borderWidth:2},thumbImage:{width:'100%',height:46},thumbLabel:{color:C.muted,textAlign:'center',fontSize:9,paddingTop:2},
 details:{maxHeight:270,borderTopWidth:1,borderTopColor:C.line},detailsContent:{padding:12},product:{color:C.text,fontSize:23,fontWeight:'900',textShadowColor:C.blue,textShadowRadius:10},match:{color:C.green,fontSize:9,fontWeight:'900',letterSpacing:1.2,marginTop:5},empty:{color:C.muted,fontSize:12,lineHeight:18},twoPanels:{flexDirection:'row',gap:10,marginTop:12,alignItems:'flex-start'},factPanel:{flex:1,minWidth:0},researchPanel:{flex:1,minWidth:0,borderLeftWidth:1,borderLeftColor:C.line,paddingLeft:8},panelTitle:{color:C.blue,fontSize:10,fontWeight:'900',letterSpacing:1,marginBottom:8},researchHint:{color:C.muted,fontSize:8,fontWeight:'800',marginBottom:7},fact:{width:'100%',minHeight:38,paddingVertical:7,borderBottomWidth:1,borderBottomColor:C.line},researchRow:{paddingVertical:6,borderBottomWidth:1,borderBottomColor:C.line},researchLabel:{color:C.muted,fontSize:9,lineHeight:12},researchStatus:{fontSize:8,fontWeight:'900',marginTop:3},sourceText:{color:C.muted,fontSize:8,lineHeight:11,marginBottom:5},factLabel:{color:C.blue,fontSize:9,fontWeight:'900',letterSpacing:.6,width:'38%',paddingRight:10},factValue:{color:C.text,fontSize:12,fontWeight:'700',marginTop:0,flex:1},
 note:{color:C.green,fontSize:11,textAlign:'center',paddingVertical:6},footer:{paddingHorizontal:16,paddingTop:10,paddingBottom:24,borderTopWidth:1,borderTopColor:C.line},tally:{color:C.muted,fontSize:9,fontWeight:'900',letterSpacing:1.1},actions:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:8},textAction:{paddingVertical:10},actionText:{color:C.text,fontSize:12,fontWeight:'900',letterSpacing:1},saveButton:{backgroundColor:C.blue,paddingVertical:12,paddingHorizontal:16,borderRadius:8},saveText:{color:'#061020',fontSize:10,fontWeight:'900',letterSpacing:1},
 reviewOverlay:{...StyleSheet.absoluteFillObject,backgroundColor:'#061024',padding:20,paddingTop:44},reviewHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:18},reviewTitle:{color:C.text,fontSize:22,fontWeight:'900'},reviewRow:{flexDirection:'row',alignItems:'center',paddingVertical:13,borderBottomWidth:1,borderBottomColor:C.line},reviewName:{color:C.text,fontSize:14,fontWeight:'800'},reviewMeta:{color:C.muted,fontSize:10,marginTop:4},remove:{color:C.amber,fontSize:26,paddingHorizontal:10},venue:{color:C.text,borderBottomWidth:1,borderBottomColor:C.blue,paddingVertical:12,marginBottom:14},
 grid:{flex:1,flexDirection:'row',flexWrap:'wrap',gap:8,padding:10,alignContent:'flex-start'},gridCell:{width:'48%',height:210}
});
