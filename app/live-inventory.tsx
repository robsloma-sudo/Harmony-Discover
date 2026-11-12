import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

export function LiveInventoryPanel({onClose}:{onClose?:()=>void}={}) {
  const [expanded,setExpanded]=useState<string[]>(['identity','sku']);
  const toggle=(id:string)=>setExpanded(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id]);
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
        <View style={s.dot}/>
        <View style={{flex:1}}>
          <Text style={s.statusTitle}>VIEWFINDER READY</Text>
          <Text style={s.statusBody}>The camera stays on the main screen. Scanner controls and results belong here.</Text>
        </View>
      </View>
      <Text style={s.note}>Live recognition is being connected to the shared camera feed. This panel will not start a second camera or show a separate scanner screen.</Text>
    </View>
    <ScrollView style={s.scroll} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
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
 empty:{color:C.amber,fontSize:10,fontWeight:'800'},
 emptyHint:{color:C.muted,fontSize:9,lineHeight:14,marginTop:4},
 footer:{paddingVertical:18,alignItems:'center'},
 footerText:{color:'#68717C',fontSize:7,fontWeight:'800',letterSpacing:1},
});
