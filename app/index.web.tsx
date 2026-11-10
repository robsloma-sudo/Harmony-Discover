import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';

const C = { bg: '#07090C', panel: '#10141A', line: 'rgba(174,183,193,0.22)', ivory: '#F0F1F2', muted: '#929AA4', brass: '#AEB7C1' };
function Action({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.action, pressed && s.pressed]}><View style={s.actionCopy}><Text style={s.actionTitle}>{title}</Text><Text style={s.actionSubtitle}>{subtitle}</Text></View><Text style={s.arrow}>›</Text></Pressable>;
}
export default function WebHome() {
  return <ScrollView style={s.root} contentContainerStyle={s.content}>
    <View style={s.header}><Text style={s.brand}>HARMONY</Text><Text style={s.brandSub}>D I S C O V E R</Text></View>
    <View style={s.hero}><Text style={s.eyebrow}>YOUR NEXT GREAT POUR STARTS HERE</Text><Text style={s.title}>Discover what’s worth drinking.</Text><Text style={s.body}>Explore beverage menus, save discoveries, and build your taste.</Text></View>
    <View style={s.actions}>
      <Action title="READ A MENU" subtitle="Upload menu photos and review what’s listed" onPress={() => router.push('/scan')} />
      <Action title="MY COLLECTION" subtitle="Return to drinks you’ve saved" onPress={() => router.push('/collection')} />
      <Action title="JOURNEYS" subtitle="Explore guided beverage education" onPress={() => router.push('/journey')} />
      <Action title="MY TASTE" subtitle="See your evolving taste profile" onPress={() => router.push('/taste')} />
      <Action title="NEARBY" subtitle="Discover places around you" onPress={() => router.push('/nearby')} />
    </View><Text style={s.footer}>NO BAD DRINKS. JUST BAD DECISIONS.</Text>
  </ScrollView>;
}
const s = StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg}, content:{flexGrow:1,width:'100%',maxWidth:680,alignSelf:'center',paddingHorizontal:24,paddingTop:38,paddingBottom:36},
  header:{borderBottomWidth:1,borderBottomColor:C.line,paddingBottom:22}, brand:{color:C.ivory,fontSize:19,fontWeight:'900',letterSpacing:4},brandSub:{color:C.brass,fontSize:9,fontWeight:'700',letterSpacing:3,marginTop:5},
  hero:{paddingTop:42,paddingBottom:30},eyebrow:{color:C.brass,fontSize:10,fontWeight:'800',letterSpacing:2},title:{color:C.ivory,fontSize:38,lineHeight:44,fontWeight:'800',marginTop:14,maxWidth:540},body:{color:C.muted,fontSize:15,lineHeight:23,marginTop:12,maxWidth:500},
  actions:{gap:11},action:{minHeight:82,paddingHorizontal:18,paddingVertical:16,borderRadius:14,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},pressed:{opacity:0.72},actionCopy:{flex:1,paddingRight:12},actionTitle:{color:C.ivory,fontSize:13,fontWeight:'800',letterSpacing:1.2},actionSubtitle:{color:C.muted,fontSize:12,lineHeight:17,marginTop:5},arrow:{color:C.brass,fontSize:30,fontWeight:'300'},footer:{color:C.muted,textAlign:'center',fontSize:9,fontWeight:'700',letterSpacing:2,marginTop:34}
});
