import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ActiveMenuContribution, listActiveMenuContributions, withdrawObservationContribution } from '../services/discoverObservationApi';

const gold='#D5AE70', muted='#A7B0BA', ink='#F0E9DD', panel='#151B22', border='#303A45';
export default function PrivacyPanel() {
  const [items,setItems]=useState<ActiveMenuContribution[]>([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const load=useCallback(async()=>{setLoading(true);try{setItems(await listActiveMenuContributions());setMessage('');}catch{setMessage('Could not load contribution permissions. Try again.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  function withdraw(item:ActiveMenuContribution){
    Alert.alert('Withdraw permission?','This stops this observation from entering any future Discover-to-Harmony review. If data was already promoted, a separate deletion review is required.',[
      {text:'Keep permission',style:'cancel'},
      {text:'Withdraw',style:'destructive',onPress:async()=>{setBusyId(item.observationId);try{await withdrawObservationContribution(item.observationId);setItems(current=>current.filter(v=>v.observationId!==item.observationId));setMessage('Permission withdrawn. Any unpromoted staging record is blocked.');}catch{setMessage('Withdrawal could not be confirmed. Refresh and try again.');}finally{setBusyId(null);}}}
    ]);
  }
  return <ScrollView style={{maxHeight:470}} contentContainerStyle={{gap:10,paddingBottom:8}}>
    <Text style={{color:muted,fontSize:11,lineHeight:17}}>Manage separate permissions to contribute extracted menu details to a private review queue. This is not permission to publish a menu.</Text>
    {loading?<ActivityIndicator color={gold}/>:items.length===0?<View style={{backgroundColor:panel,borderColor:border,borderWidth:1,borderRadius:12,padding:13}}><Text style={{color:ink,fontWeight:'700'}}>No active contribution permissions</Text><Text style={{color:muted,fontSize:11,marginTop:5}}>You have not granted any active menu contribution permissions.</Text></View>:items.map(item=><View key={item.grantId} style={{backgroundColor:panel,borderColor:border,borderWidth:1,borderRadius:12,padding:12,gap:6}}>
      <Text style={{color:ink,fontSize:13,fontWeight:'800'}}>{item.venueName}</Text>
      <Text style={{color:muted,fontSize:10}}>Scan: {item.capturedAt?new Date(item.capturedAt).toLocaleDateString():'Date unavailable'}</Text>
      <Text style={{color:muted,fontSize:10}}>Permission: {item.policyVersion} · {item.status.replaceAll('_',' ')}</Text>
      <Pressable disabled={busyId===item.observationId} onPress={()=>withdraw(item)} style={{alignSelf:'flex-start',borderWidth:1,borderColor:'#C78378',borderRadius:8,padding:9,opacity:busyId===item.observationId?0.5:1}}><Text style={{color:'#D99A90',fontSize:10,fontWeight:'800'}}>{busyId===item.observationId?'WITHDRAWING…':'WITHDRAW PERMISSION'}</Text></Pressable>
    </View>)}
    {!!message&&<Text style={{color:gold,fontSize:11,lineHeight:16}}>{message}</Text>}
    <Pressable onPress={()=>void load()} style={{alignSelf:'flex-start',borderWidth:1,borderColor:gold,borderRadius:8,padding:9}}><Text style={{color:gold,fontSize:10,fontWeight:'800'}}>REFRESH PERMISSIONS</Text></Pressable>
  </ScrollView>;
}
