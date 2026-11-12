import { useEffect, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, Switch, StyleSheet } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { supabase } from '../services/supabase';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';

type Memory = { id: string; category: 'taste_preference' | 'drink_history' | 'interaction_style'; label: string; value: string };
const C = { bg: '#090B0F', panel: '#141820', line: '#303741', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0' };

export function MartyConsentPanel() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [category, setCategory] = useState<Memory['category']>('taste_preference');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState('Loading consent settings…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!userId) { setStatus('Sign in to manage private voice and memory settings.'); return; }
    void (async () => {
      const { data, error } = await supabase.from('bartender_voice_consents').select('*').eq('user_id', userId).maybeSingle();
      if (!alive) return;
      if (error) { setStatus('DEV consent tables are not ready yet.'); return; }
      setVoiceEnabled(Boolean(data?.voice_enabled && !data?.voice_withdrawn_at));
      setMemoryEnabled(Boolean(data?.memory_enabled && !data?.memory_withdrawn_at));
      setStatus('');
    })();
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    let alive = true;
    if (!userId || !memoryEnabled) { setMemories([]); return; }
    void supabase.from('bartender_memories').select('id,category,label,value').eq('user_id', userId).order('updated_at', { ascending: false })
      .then(({ data, error }) => { if (!alive) return; if (error) setStatus('Could not load saved memories.'); else setMemories((data ?? []) as Memory[]); });
    return () => { alive = false; };
  }, [userId, memoryEnabled]);

  async function saveConsent() {
    if (!userId || busy) return;
    setBusy(true); setStatus('Saving your choices…');
    try {
      const now = new Date().toISOString();
      // Withdraw consent first so no new session can use memory while cleanup runs.
      // The owner DELETE policy remains available even after memory consent is false.
      const { error } = await supabase.from('bartender_voice_consents').upsert({
        user_id: userId,
        voice_enabled: voiceEnabled,
        memory_enabled: memoryEnabled,
        voice_consent_version: voiceEnabled ? MARTY_BOSTON_CONSENT_VERSION : null,
        memory_consent_version: memoryEnabled ? MARTY_BOSTON_CONSENT_VERSION : null,
        voice_granted_at: voiceEnabled ? now : null,
        memory_granted_at: memoryEnabled ? now : null,
        voice_withdrawn_at: voiceEnabled ? null : now,
        memory_withdrawn_at: memoryEnabled ? null : now,
        updated_at: now,
      }, { onConflict: 'user_id' });
      if (error) throw error;
      if (!memoryEnabled) {
        const { error: deleteError } = await supabase.from('bartender_memories').delete().eq('user_id', userId);
        if (deleteError) {
          setMemories([]);
          setStatus('Memory consent is off, but stored entries could not be fully deleted. Retry or contact support.');
          return;
        }
        setMemories([]);
      }
      setStatus('Saved. Voice and memory permissions are separate and can be changed here.');
    } catch {
      setStatus('Could not save consent. Check that the Discover DEV migration is applied.');
    } finally { setBusy(false); }
  }

  async function addMemory() {
    if (!userId || !memoryEnabled || !label.trim() || !value.trim()) { setStatus('Enable memory and enter both a label and value.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('bartender_memories').upsert({
      user_id: userId, category, label: label.trim(), value: value.trim(),
      source: 'user_confirmed', consent_version: MARTY_BOSTON_CONSENT_VERSION,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,category,label' }).select('id,category,label,value').single();
    if (error) setStatus('Memory was not saved. Verify consent and DEV migration status.');
    else { setMemories(old => [data as Memory, ...old.filter(m => !(m.category === data.category && m.label === data.label))]); setLabel(''); setValue(''); setStatus('Saved only because you explicitly chose to save it.'); }
    setBusy(false);
  }

  async function removeMemory(id: string) {
    if (!userId) return;
    const { error } = await supabase.from('bartender_memories').delete().eq('id', id).eq('user_id', userId);
    if (error) setStatus('Could not delete that memory.');
    else { setMemories(old => old.filter(m => m.id !== id)); setStatus('Memory deleted.'); }
  }

  if (!userId) return <View style={s.root}><Text style={s.title}>Sign in first.</Text><Text style={s.body}>Saved memories belong to your account.</Text></View>;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      
      <Text style={s.kicker}>MARTY SULLIVAN · PRIVACY CONTROLS</Text>
      <Text style={s.title}>Your choices. Your call.</Text>
      <Text style={s.body}>Voice and cross-session memory are separate opt-ins. Neither is enabled by default. Marty uses only the permissions you actively grant.</Text>
      <View style={s.card}>
        <View style={s.toggleRow}><View style={s.copy}><Text style={s.heading}>Live voice</Text><Text style={s.bodySmall}>Allow push-to-talk Realtime conversations after microphone permission. No background listening.</Text></View><Switch value={voiceEnabled} onValueChange={setVoiceEnabled} trackColor={{ true: C.gold }} /></View>
        <View style={s.rule} />
        <View style={s.toggleRow}><View style={s.copy}><Text style={s.heading}>Saved bartender memory</Text><Text style={s.bodySmall}>Allow only facts or preferences you manually save. This is not automatic profiling.</Text></View><Switch value={memoryEnabled} onValueChange={setMemoryEnabled} trackColor={{ true: C.gold }} /></View>
        <Pressable style={s.primary} disabled={busy} onPress={() => void saveConsent()}><Text style={s.primaryText}>{busy ? 'SAVING…' : 'SAVE CONSENT CHOICES'}</Text></Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Saved memories</Text>
        <Text style={s.bodySmall}>Only non-sensitive beverage preferences, drink history, and interaction preferences. You add each memory yourself. Turning memory off deletes this user's saved bartender memories.</Text>
        {!memoryEnabled ? <Text style={s.notice}>Enable saved memory above and save your choice to manage entries.</Text> : <>
          <View style={s.categoryRow}>
            {(['taste_preference','drink_history','interaction_style'] as const).map(v => <Pressable key={v} onPress={() => setCategory(v)} style={[s.category, category === v && s.categoryOn]}><Text style={[s.categoryText, category === v && s.categoryTextOn]}>{v.replace('_',' ')}</Text></Pressable>)}
          </View>
          <TextInput value={label} onChangeText={setLabel} placeholder="Short label (e.g. favorite spirit)" placeholderTextColor="#707985" style={s.input} />
          <TextInput value={value} onChangeText={setValue} placeholder="What should Marty remember?" placeholderTextColor="#707985" multiline style={[s.input,{minHeight:70}]} />
          <Pressable style={s.secondary} disabled={busy} onPress={() => void addMemory()}><Text style={s.secondaryText}>SAVE THIS MEMORY</Text></Pressable>
          {memories.map(m => <View key={m.id} style={s.memoryRow}><View style={s.copy}><Text style={s.memoryTitle}>{m.label}</Text><Text style={s.bodySmall}>{m.category.replace('_',' ')} · {m.value}</Text></View><Pressable onPress={() => void removeMemory(m.id)}><Text style={s.delete}>DELETE</Text></Pressable></View>)}
        </>}
      </View>
      {!!status && <Text style={s.status}>{status}</Text>}
      <Text style={s.footer}>CONSENT POLICY {MARTY_BOSTON_CONSENT_VERSION} · PRIVATE TO YOUR DISCOVER ACCOUNT</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:'transparent'},content:{padding:4,paddingTop:4,paddingBottom:16,gap:12},back:{color:C.gold,fontSize:11,fontWeight:'800',letterSpacing:1.3},
  kicker:{color:C.gold,fontSize:9,letterSpacing:1.8,fontWeight:'800',marginTop:12},title:{color:C.text,fontSize:31,fontWeight:'800'},body:{color:C.muted,fontSize:13,lineHeight:20},
  card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:16,padding:16,gap:14},toggleRow:{flexDirection:'row',alignItems:'center',gap:12},copy:{flex:1},heading:{color:C.text,fontSize:15,fontWeight:'800'},bodySmall:{color:C.muted,fontSize:11,lineHeight:17,marginTop:4},
  rule:{height:1,backgroundColor:C.line},primary:{backgroundColor:C.gold,padding:14,borderRadius:9,alignItems:'center'},primaryText:{color:'#111',fontWeight:'900',fontSize:11,letterSpacing:1},
  notice:{color:C.muted,fontSize:12},categoryRow:{flexDirection:'row',flexWrap:'wrap',gap:7},category:{borderWidth:1,borderColor:C.line,borderRadius:8,paddingVertical:7,paddingHorizontal:9},categoryOn:{backgroundColor:C.gold,borderColor:C.gold},
  categoryText:{color:C.muted,fontSize:9,textTransform:'capitalize'},categoryTextOn:{color:'#111',fontWeight:'800'},input:{backgroundColor:'#0D1117',borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,color:C.text,fontSize:12,textAlignVertical:'top'},
  secondary:{alignSelf:'flex-start',borderWidth:1,borderColor:C.gold,paddingVertical:10,paddingHorizontal:14,borderRadius:8},secondaryText:{color:C.gold,fontSize:10,fontWeight:'800',letterSpacing:1},
  memoryRow:{flexDirection:'row',alignItems:'center',gap:10,borderTopWidth:1,borderTopColor:C.line,paddingTop:12},memoryTitle:{color:C.text,fontSize:12,fontWeight:'800'},delete:{color:'#D78A83',fontSize:9,fontWeight:'800'},
  status:{color:C.gold,fontSize:11,lineHeight:16},footer:{color:'#707985',fontSize:8,textAlign:'center',letterSpacing:1.1},
});
