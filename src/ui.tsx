import { View, ScrollView, StyleSheet, Text, Pressable } from 'react-native';
import type { ReactNode } from 'react';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const colors = { bg:'#0D1117', panel:'#171E27', border:'#2A3542', text:'#F4F1E9', muted:'#A6B0BA', accent:'#D7B77A' };
const tabs = [
  { path:'/', label:'Discover', icon:'camera-outline' as const, activeIcon:'camera' as const },
  { path:'/nearby', label:'Nearby', icon:'compass-outline' as const, activeIcon:'compass' as const },
  { path:'/collection', label:'Library', icon:'bookmark-outline' as const, activeIcon:'bookmark' as const },
  { path:'/taste', label:'My taste', icon:'wine-outline' as const, activeIcon:'wine' as const },
  { path:'/settings', label:'Settings', icon:'settings-outline' as const, activeIcon:'settings' as const },
];
export function Screen({ children, hideTabs = false }: { children: ReactNode; hideTabs?: boolean }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <ScrollView style={styles.pageScroll} contentContainerStyle={[styles.content, { paddingBottom: 112 + Math.max(insets.bottom, 8) }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {!hideTabs && <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) + 5 }]}>
        {tabs.map(tab => {
          const active = tab.path === '/' ? pathname === '/' : pathname === tab.path || pathname.startsWith(tab.path + '/');
          return <Pressable key={tab.path} accessibilityRole="button" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} onPress={() => { if (!active) router.replace(tab.path as never); }} style={styles.tab}>
            <Ionicons name={active ? tab.activeIcon : tab.icon} size={19} color={active ? colors.accent : colors.muted} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>;
        })}
      </View>}
    </View>
  );
}
export const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.bg}, pageScroll:{flex:1}, content:{padding:24,paddingTop:64,paddingBottom:112},
  tabBar:{position:'absolute',left:12,right:12,bottom:0,minHeight:66,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingTop:10,paddingHorizontal:5,backgroundColor:'#111820',borderWidth:1,borderColor:'#34404C',borderRadius:18,shadowColor:'#000',shadowOpacity:0.3,shadowRadius:14,shadowOffset:{width:0,height:-3},elevation:14},
  tab:{flex:1,minWidth:0,alignItems:'center',justifyContent:'center',gap:4,paddingVertical:3}, tabLabel:{color:colors.muted,fontSize:9,fontWeight:'700',letterSpacing:0.2}, tabLabelActive:{color:colors.accent},
  brand:{color:colors.text,fontSize:28,fontWeight:'800',letterSpacing:5}, eyebrow:{color:colors.accent,fontSize:11,fontWeight:'700',letterSpacing:2,marginTop:8},
  hero:{color:colors.text,fontSize:40,fontWeight:'700',lineHeight:46,marginTop:22}, title:{color:colors.text,fontSize:32,fontWeight:'700',marginTop:18},
  sub:{color:colors.muted,fontSize:15,lineHeight:23,marginTop:10,marginBottom:24}, primary:{backgroundColor:colors.accent,padding:20,borderRadius:18,marginTop:12},
  primaryText:{color:'#15191F',fontSize:18,fontWeight:'800'}, primaryHint:{color:'#34302A',fontSize:12,marginTop:5},
  secondary:{borderWidth:1,borderColor:colors.border,padding:17,borderRadius:16,marginTop:12,alignItems:'center'},
  secondaryText:{color:colors.text,fontSize:15,fontWeight:'700'}, sectionTitle:{color:colors.text,fontSize:18,fontWeight:'700',marginTop:28,marginBottom:12},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:10}, category:{width:'48%',backgroundColor:colors.panel,borderRadius:16,padding:15,minHeight:96},
  categoryTitle:{color:colors.text,fontWeight:'700',fontSize:16}, categoryDesc:{color:colors.muted,fontSize:12,lineHeight:18,marginTop:5},
  row:{flexDirection:'row',gap:16,flexWrap:'wrap'}, link:{color:colors.accent,fontWeight:'700',paddingVertical:8},
  footnote:{color:'#7D8995',fontSize:11,lineHeight:17,marginTop:24}, back:{color:colors.accent,fontSize:15,marginBottom:22},
  item:{flexDirection:'row',alignItems:'center',gap:10,padding:14,backgroundColor:colors.panel,borderRadius:14,marginBottom:9},
  itemTitle:{color:colors.text,fontWeight:'700',fontSize:15}, price:{color:colors.accent,fontWeight:'700'}, chevron:{color:colors.muted,fontSize:24},
  journeySection:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:16,marginTop:12},
  body:{color:colors.text,fontSize:15,lineHeight:24}, evidence:{color:colors.accent,fontSize:10,marginTop:8,textTransform:'uppercase',letterSpacing:1}
});