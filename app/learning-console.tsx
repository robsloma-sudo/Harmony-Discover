import { useMemo, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Screen, colors } from '../src/ui';

type Status = 'Needs review' | 'Research suggested' | 'Insufficient evidence';
type Candidate = {
  id: string; title: string; domain: string; summary: string;
  evidence: string; confidence: string; status: Status; action: string;
};

const SAMPLE: Candidate[] = [
  { id:'LE-001', title:'Lower-sweetness cocktail adjustments', domain:'Cocktail Intelligence',
    summary:'A repeated pattern of users adjusting saved cocktail remixes toward drier profiles.',
    evidence:'Illustrative sample · 38 consenting subjects · 52 sessions · 14 days',
    confidence:'Promising internal signal', status:'Needs review',
    action:'Research dry-style balance, acid/sugar tradeoffs, and validated spec examples.' },
  { id:'LE-002', title:'Mezcal production questions', domain:'Journeys · Agave',
    summary:'Users frequently select production and smoke-origin questions after opening mezcal items.',
    evidence:'Illustrative sample · 31 consenting subjects · 46 sessions · 11 days',
    confidence:'Promising internal signal', status:'Research suggested',
    action:'Audit existing agave Journey coverage and identify source-backed gaps.' },
  { id:'LE-003', title:'Wine region comparison requests', domain:'Wine Intelligence',
    summary:'A smaller group asks for side-by-side regional comparisons, but the sample is not yet broad.',
    evidence:'Illustrative sample · 12 consenting subjects · 15 sessions · 5 days',
    confidence:'Insufficient evidence', status:'Insufficient evidence',
    action:'Continue observing; do not create a trend claim or prioritize a content rewrite.' },
];

export default function LearningConsoleScreen() {
  const [filter, setFilter] = useState<'All' | Status>('All');
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const items = useMemo(() => SAMPLE.filter(x => filter === 'All' || x.status === filter), [filter]);

  const decide = (id: string, decision: string) =>
    setDecisions(prev => ({ ...prev, [id]: decision }));

  return (
    <Screen>
      <Text style={s.eyebrow}>INTERNAL HARMONY TOOL · SAMPLE DATA</Text>
      <Text style={s.title}>Learning Review</Text>
      <Text style={s.sub}>Turn consented user signals into research priorities. These examples are illustrative and are not live consumer data.</Text>

      <View style={s.notice}>
        <Text style={s.noticeTitle}>Review rule</Text>
        <Text style={s.noticeText}>Signals are hypotheses, not facts. No candidate can modify canonical Harmony knowledge from this screen.</Text>
      </View>

      <View style={s.metrics}>
        <Metric value="03" label="Sample candidates" />
        <Metric value="02" label="Research-worthy" />
        <Metric value="01" label="Below threshold" />
      </View>

      <Text style={s.section}>Review queue</Text>
      <View style={s.filters}>
        {(['All','Needs review','Research suggested','Insufficient evidence'] as const).map(v => (
          <Pressable key={v} onPress={() => setFilter(v)} style={[s.filter, filter === v && s.filterActive]}>
            <Text style={[s.filterText, filter === v && s.filterTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>

      {items.map(item => (
        <View key={item.id} style={s.card}>
          <View style={s.cardTop}>
            <Text style={s.id}>{item.id}</Text>
            <Text style={s.domain}>{item.domain}</Text>
          </View>
          <Text style={s.cardTitle}>{item.title}</Text>
          <Text style={s.body}>{item.summary}</Text>
          <Text style={s.evidence}>{item.evidence}</Text>
          <Text style={s.confidence}>{item.confidence}</Text>
          <View style={s.divider} />
          <Text style={s.actionLabel}>SUGGESTED NEXT STEP</Text>
          <Text style={s.body}>{item.action}</Text>
          <View style={s.buttons}>
            <Pressable onPress={() => decide(item.id, 'Research task drafted')} style={s.primary}>
              <Text style={s.primaryText}>Draft research task</Text>
            </Pressable>
            <Pressable onPress={() => decide(item.id, 'Deferred')} style={s.secondary}>
              <Text style={s.secondaryText}>Defer</Text>
            </Pressable>
          </View>
          {decisions[item.id] ? <Text style={s.decision}>Local demo action: {decisions[item.id]}. Not saved to a server.</Text> : null}
        </View>
      ))}

      <Text style={s.foot}>DEVELOPMENT PREVIEW · No live API, database write, or production connection. A real review workflow requires authenticated staff roles, audit history, evidence links, and explicit approval gates.</Text>
    </Screen>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={s.metric}><Text style={s.metricValue}>{value}</Text><Text style={s.metricLabel}>{label}</Text></View>;
}

const s = StyleSheet.create({
  eyebrow:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1.7},
  title:{color:colors.text,fontSize:32,fontWeight:'800',marginTop:12},
  sub:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:8,marginBottom:18},
  notice:{backgroundColor:'#202B35',borderColor:'#40505D',borderWidth:1,borderRadius:14,padding:15},
  noticeTitle:{color:colors.accent,fontSize:14,fontWeight:'800'},
  noticeText:{color:colors.text,fontSize:13,lineHeight:20,marginTop:5},
  metrics:{flexDirection:'row',gap:8,marginTop:14},
  metric:{flex:1,backgroundColor:colors.panel,borderColor:colors.border,borderWidth:1,borderRadius:12,padding:12},
  metricValue:{color:colors.text,fontSize:24,fontWeight:'800'},
  metricLabel:{color:colors.muted,fontSize:10,lineHeight:14,marginTop:4},
  section:{color:colors.text,fontSize:19,fontWeight:'800',marginTop:24,marginBottom:12},
  filters:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},
  filter:{borderWidth:1,borderColor:colors.border,borderRadius:20,paddingHorizontal:11,paddingVertical:8},
  filterActive:{backgroundColor:colors.accent,borderColor:colors.accent},
  filterText:{color:colors.muted,fontSize:11,fontWeight:'700'},
  filterTextActive:{color:'#15191F'},
  card:{backgroundColor:colors.panel,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:16,marginBottom:12},
  cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  id:{color:colors.accent,fontSize:10,fontWeight:'800',letterSpacing:1},
  domain:{color:colors.muted,fontSize:10,fontWeight:'700'},
  cardTitle:{color:colors.text,fontSize:18,fontWeight:'800',marginTop:12},
  body:{color:colors.text,fontSize:13,lineHeight:20,marginTop:7},
  evidence:{color:colors.muted,fontSize:11,lineHeight:17,marginTop:12},
  confidence:{color:colors.accent,fontSize:11,fontWeight:'800',marginTop:6},
  divider:{height:1,backgroundColor:colors.border,marginVertical:14},
  actionLabel:{color:colors.muted,fontSize:9,fontWeight:'800',letterSpacing:1.4},
  buttons:{flexDirection:'row',gap:8,marginTop:14},
  primary:{backgroundColor:colors.accent,borderRadius:10,paddingHorizontal:13,paddingVertical:11},
  primaryText:{color:'#15191F',fontWeight:'800',fontSize:12},
  secondary:{borderWidth:1,borderColor:colors.border,borderRadius:10,paddingHorizontal:13,paddingVertical:11},
  secondaryText:{color:colors.text,fontWeight:'700',fontSize:12},
  decision:{color:'#A8D5B5',fontSize:11,marginTop:10},
  foot:{color:'#7D8995',fontSize:10,lineHeight:16,marginTop:16,marginBottom:20},
});
