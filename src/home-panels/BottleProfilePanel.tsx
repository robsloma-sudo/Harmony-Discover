import React from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import type { BottleRead, BottleIntelligenceProfile } from "../services/discoverLiveApi";
import { getBottleFamilyLabel, getBottleIntelligenceSections } from "../services/bottleIntelligenceSchema";
import { displayName } from '../live/foundTray';
import { profileFieldValues } from './profileFields';

type Props = { bottle: BottleRead; onClose: () => void; intelligence?: BottleIntelligenceProfile | null; intelligenceLoading?: boolean };

const C = { bg:"#0A0D12", panel:"#111720", line:"rgba(153,163,174,0.18)", brass:"#C6A36A", ivory:"#F0F1F2", muted:"#89929D", green:"#77E5B5" };
const asText = (value: unknown): string => Array.isArray(value) ? value.map(String).join(", ") : typeof value === "string" || typeof value === "number" ? String(value) : "";

export function BottleProfilePanel({ bottle, onClose, intelligence = null, intelligenceLoading = false }: Props) {
  const details = bottle.details || {};
  const family = getBottleFamilyLabel(bottle.category, details);
  const sections = getBottleIntelligenceSections(bottle.category, details);
  const identity = displayName(bottle.match?.brand || bottle.brand, bottle.match?.product || bottle.product) || "Bottle identity pending";
  const fields: Record<string, unknown> = profileFieldValues(bottle, intelligence);
  const shownKeys = new Set(sections.flatMap(section => section.fields.map(item => item.key)));
  const covered = new Set(['producer','winery','distillery','estate','brand_owner','net_contents','package_size','alcohol_statement','origin','subcategory','harvested_on','distillation','state_or_province','grain','flavor','production_method']);
  const extraAttributes = (intelligence?.attributes ?? []).filter(attribute => !shownKeys.has(attribute.attribute_code) && !covered.has(attribute.attribute_code)
    && (attribute.value_text || attribute.value_numeric !== null || asText(attribute.value_json)));
  const sources = bottle.researchSources || [];
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{flex:1}}>
          <Text style={styles.eyebrow}>HARMONY BOTTLE INTELLIGENCE</Text>
          <Text style={styles.name}>{identity}</Text>
          <Text style={styles.family}>{family.toUpperCase()} · {bottle.state === "matched" ? "CATALOG MATCH" : bottle.state === "reported" ? "REPORTED IDENTITY" : "IDENTITY NEEDS CONFIRMATION"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close bottle profile" onPress={onClose} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.confidenceRow}>
          <Text style={styles.confidenceLabel}>SCAN CONFIDENCE</Text>
          <Text style={styles.confidenceValue}>{Math.round((bottle.confidence || 0) * 100)}%</Text>
        </View>
        {sections.map(section => (
          // Every category is listed; one without a value says "No data" (no internal descriptions).
          <View key={section.id} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {/* Known facts first, then the empty categories. */}
            {[...section.fields].sort((a, b) => Number(!asText(fields[a.key]).trim()) - Number(!asText(fields[b.key]).trim())).map(item => {
              const value = asText(fields[item.key]).trim();
              return (
                <View key={item.key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{item.label.toUpperCase()}</Text>
                  <Text style={value ? styles.fieldValue : styles.noData}>{value || "No data"}</Text>
                </View>
              );
            })}
          </View>
        ))}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>More facts</Text>
          {intelligenceLoading && !extraAttributes.length ? <Text style={styles.noData}>Looking up…</Text> : null}
          {!intelligenceLoading && !extraAttributes.length ? <Text style={styles.noData}>No data</Text> : null}
          {extraAttributes.map(attribute => {
            const raw = attribute.value_text ?? (attribute.value_numeric !== null ? String(attribute.value_numeric) + (attribute.unit ? " " + attribute.unit : "") : asText(attribute.value_json));
            return (
              <View key={attribute.attribute_code} style={styles.field}>
                <Text style={styles.fieldLabel}>{attribute.attribute_code.replace(/_/g, " ").toUpperCase()}</Text>
                <Text style={styles.fieldValue}>{raw}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sources</Text>
          {(intelligence?.evidence ?? []).filter(evidence => evidence.source_url || evidence.source_name).map((evidence, index) => (
            <View key={"e" + index + (evidence.source_url || "")} style={styles.source}>
              <Text style={styles.sourceTitle}>{evidence.source_name || "Source"}</Text>
              {evidence.source_url ? <Text style={styles.sourceUrl}>{evidence.source_url}</Text> : null}
            </View>
          ))}
          {sources.map((source, index) => (
            <View key={"r" + index + source.url} style={styles.source}>
              <Text style={styles.sourceTitle}>{source.title || "Source"}</Text>
              <Text style={styles.sourceUrl}>{source.url}</Text>
            </View>
          ))}
          {!sources.length && !(intelligence?.evidence ?? []).some(evidence => evidence.source_url || evidence.source_name)
            ? <Text style={styles.noData}>{intelligenceLoading ? "Looking up…" : "No data"}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:C.bg,borderRadius:18,overflow:"hidden"},
  header:{flexDirection:"row",alignItems:"flex-start",gap:12,padding:16,borderBottomWidth:1,borderBottomColor:C.line,backgroundColor:C.panel},
  eyebrow:{color:C.brass,fontSize:8,fontWeight:"900",letterSpacing:1.5},
  name:{color:C.ivory,fontSize:20,fontWeight:"900",marginTop:7},
  family:{color:C.green,fontSize:9,fontWeight:"900",letterSpacing:1,marginTop:6},
  close:{width:34,height:34,borderRadius:17,borderWidth:1,borderColor:C.line,alignItems:"center",justifyContent:"center"},
  closeText:{color:C.ivory,fontSize:24,lineHeight:27},
  content:{padding:14,paddingBottom:28},
  confidenceRow:{padding:12,borderRadius:10,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,marginBottom:12},
  confidenceLabel:{color:C.muted,fontSize:8,fontWeight:"900",letterSpacing:1},
  confidenceValue:{color:C.green,fontSize:22,fontWeight:"900",marginTop:4},
  confidenceNote:{color:C.muted,fontSize:9,marginTop:3},
  section:{padding:13,marginBottom:10,borderRadius:11,borderWidth:1,borderColor:C.line,backgroundColor:"rgba(17,23,32,0.68)"},
  sectionTitle:{color:C.ivory,fontSize:12,fontWeight:"900",letterSpacing:0.6},
  sectionDescription:{color:C.muted,fontSize:9,lineHeight:14,marginTop:4,marginBottom:7},
  field:{paddingVertical:8,borderTopWidth:1,borderTopColor:"rgba(153,163,174,0.10)"},
  fieldLabel:{color:C.brass,fontSize:8,fontWeight:"900",letterSpacing:0.8},
  fieldValue:{color:C.ivory,fontSize:12,fontWeight:"700",lineHeight:17,marginTop:3},
  fieldDescription:{color:C.muted,fontSize:8,lineHeight:12,marginTop:2},
  noData:{color:"#68727D",fontSize:12,fontWeight:"600",lineHeight:17,marginTop:3},
  source:{paddingVertical:8,borderTopWidth:1,borderTopColor:"rgba(153,163,174,0.10)"},
  sourceTitle:{color:C.ivory,fontSize:10,fontWeight:"800"},
  sourceMeta:{color:C.brass,fontSize:8,marginTop:3},
  sourceUrl:{color:C.muted,fontSize:8,marginTop:3},
  footer:{color:C.muted,fontSize:8,lineHeight:13,textAlign:"center",padding:12},
});
