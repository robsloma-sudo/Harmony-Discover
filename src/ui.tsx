import { View, ScrollView, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
export const colors = { bg:'#0D1117', panel:'#171E27', border:'#2A3542', text:'#F4F1E9', muted:'#A6B0BA', accent:'#D7B77A' };
export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></View>;
}
export const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.bg}, content:{padding:24,paddingTop:64,paddingBottom:40},
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
