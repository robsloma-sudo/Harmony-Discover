import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

export type JourneyScanItem = {
  id: string;
  kind: 'bottle' | 'menu_item';
  name: string;
  subtitle: string;
};

export default function JourneyPlayerOverlay({item,onClose}:{item:JourneyScanItem;onClose:()=>void}) {
  return <View style={{position:'absolute',zIndex:110,left:0,right:0,top:0,bottom:0,backgroundColor:'rgba(2,6,16,0.97)',padding:20,justifyContent:'center'}}>
    <View style={{position:'absolute',left:18,right:18,top:55,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
      <View><Text style={{color:'#8BB9FF',fontSize:9,fontWeight:'900',letterSpacing:2}}>HARMONY DISCOVER</Text><Text style={{color:'#EAF2FF',fontSize:12,fontWeight:'900',letterSpacing:1.6,marginTop:4}}>JOURNEY PLAYER</Text></View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close journey player" style={{padding:9}}><Text style={{color:'#EAF2FF',fontSize:13,fontWeight:'800'}}>CLOSE ×</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={{alignItems:'center',paddingTop:50,paddingBottom:40}}>
      <View style={{width:74,height:74,borderRadius:37,borderWidth:1,borderColor:'rgba(78,145,255,0.75)',backgroundColor:'rgba(26,74,145,0.18)',alignItems:'center',justifyContent:'center',marginBottom:22,shadowColor:'#287BFF',shadowOpacity:0.75,shadowRadius:24,elevation:12}}>
        <Text style={{fontSize:30,color:'#A9D0FF'}}>◉</Text>
      </View>
      <Text style={{color:'#7EAEF6',fontSize:9,fontWeight:'900',letterSpacing:2,marginBottom:10}}>{item.kind==='bottle'?'BOTTLE JOURNEY':'MENU JOURNEY'}</Text>
      <Text style={{color:'#F2F6FF',fontSize:25,fontWeight:'800',textAlign:'center',lineHeight:31}}>{item.name}</Text>
      {!!item.subtitle&&<Text style={{color:'#A8B7D0',fontSize:12,marginTop:8,textAlign:'center'}}>{item.subtitle}</Text>}
      <View style={{width:'100%',marginTop:28,padding:18,borderRadius:16,borderWidth:1,borderColor:'rgba(76,139,255,0.4)',backgroundColor:'rgba(9,22,46,0.82)'}}>
        <Text style={{color:'#DCEAFF',fontSize:12,fontWeight:'900',letterSpacing:1}}>JOURNEY CONNECTION NOT READY</Text>
        <Text style={{color:'#A8B7D0',fontSize:11,lineHeight:18,marginTop:10}}>The Discover player surface is in place. Playback will activate when Harmony's approved public journey service is available and has published, venue-approved content.</Text>
        <Text style={{color:'#7FA8E8',fontSize:9,lineHeight:15,marginTop:12}}>No journey has been requested, built, or played. This screen does not contact Harmony production.</Text>
      </View>
    </ScrollView>
  </View>;
}
