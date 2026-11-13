import React from "react";
import { ScrollView, Text, View, Pressable, StyleSheet } from "react-native";
import type { BottleRead, BottleIntelligenceProfile } from "../services/discoverLiveApi";
import { getBottleFamilyLabel, getBottleIntelligenceSections } from "../services/bottleIntelligenceSchema";

type Props = { bottle: BottleRead; onClose: () => void; intelligence?: BottleIntelligenceProfile | null; intelligenceLoading?: boolean };

const C = { bg:"#0A0D12", panel:"#111720", line:"rgba(153,163,174,0.18)", brass:"#C6A36A", ivory:"#F0F1F2", muted:"#89929D", green:"#77E5B5" };
const asText = (value: unknown): string => Array.isArray(value) ? value.map(String).join(", ") : typeof value === "string" || typeof value === "number" ? String(value) : "";

export function BottleProfilePanel({ bottle, onClose, intelligence = null, intelligenceLoading = false }: Props) {
  const details = bottle.details || {};
  const family = getBottleFamilyLabel(bottle.category, details);
  const sections = getBottleIntelligenceSections(bottle.category, details);
  const identity = [bottle.match?.brand || bottle.brand, bottle.product].filter(Boolean).join(" ").trim() || "Bottle identity pending";
  const fields: Record<string, unknown> = {
    ...details,
    brand: bottle.match?.brand || bottle.brand,
    product: bottle.product,
    size: bottle.size,
    proof: bottle.proof,
    origin: bottle.origin,
    label_text: bottle.words?.join(" · "),
    certifications: details.certifications,
  };
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
          <Text style={styles.confidenceNote}>Label confidence · not proof of every researched fact</Text>
        </View>
        {sections.map(section => {
          const present = section.fields.filter(item => asText(fields[item.key]).trim());
          const missing = section.fields.filter(item => !asText(fields[item.key]).trim());
          return (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionDescription}>{section.description}</Text>
              {present.length ? present.map(item => (
                <View key={item.key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{item.label.toUpperCase()}</Text>
                  <Text style={styles.fieldValue}>{asText(fields[item.key])}</Text>
                  <Text style={styles.fieldDescription}>{item.description}</Text>
                </View>
              )) : null}
              {missing.length > 0 && <Text style={styles.missing}>{missing.map(item => item.label).join(" · ")} · not yet verified</Text>}
            </View>
          );
        })}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shared product intelligence</Text>
          <Text style={styles.sectionDescription}>A background lookup checks the shared Discover product record after this profile opens. Only exact product matches are shown.</Text>
          {intelligenceLoading ? <Text style={styles.missing}>Checking the shared product record…</Text> : null}
          {!intelligenceLoading && !intelligence ? <Text style={styles.missing}>No exact shared product record found yet. This bottle remains available as a local scan profile.</Text> : null}
          {intelligence ? (
            <>
              <Text style={styles.sourceMeta}>PRODUCT RECORD · {intelligence.product.status.toUpperCase()} · {intelligence.attributes.length} ATTRIBUTES · {intelligence.evidence.length} EVIDENCE RECORDS</Text>
              {intelligence.packages.map((pkg, index) => {
                const values = [
                  pkg.package_size_ml ? String(pkg.package_size_ml) + " mL" : "",
                  pkg.abv_percent ? String(pkg.abv_percent) + "% ABV" : "",
                  asText(pkg.package_type),
                  asText(pkg.container_material),
                ].filter(Boolean);
                return values.length ? <Text key={String(index)} style={styles.fieldValue}>{values.join(" · ")}</Text> : null;
              })}
              {intelligence.attributes.map(attribute => {
                const raw = attribute.value_text ?? (attribute.value_numeric !== null ? String(attribute.value_numeric) + (attribute.unit ? " " + attribute.unit : "") : asText(attribute.value_json));
                return (
                  <View key={attribute.attribute_code} style={styles.field}>
                    <Text style={styles.fieldLabel}>{attribute.attribute_code.replace(/_/g, " ").toUpperCase()}</Text>
                    <Text style={styles.fieldValue}>{raw || attribute.state.replace(/_/g, " ")}</Text>
                    <Text style={styles.fieldDescription}>{attribute.state.replace(/_/g, " ")}{attribute.confidence !== null ? " · " + Math.round(attribute.confidence * 100) + "% confidence" : ""}</Text>
                  </View>
                );
              })}
              {intelligence.evidence.map((evidence, index) => (
                <View key={String(index) + evidence.source_type + (evidence.source_url || "")} style={styles.source}>
                  <Text style={styles.sourceTitle}>{evidence.source_name || evidence.source_type.replace(/_/g, " ")}</Text>
                  <Text style={styles.sourceMeta}>{evidence.attribute_code || "PRODUCT EVIDENCE"} · {evidence.verification_state.replace(/_/g, " ")}{evidence.confidence !== null ? " · " + Math.round(evidence.confidence * 100) + "%" : ""}</Text>
                  {evidence.source_url ? <Text style={styles.sourceUrl}>{evidence.source_url}</Text> : null}
                </View>
              ))}
            </>
          ) : null}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Research & shared evidence</Text>
          <Text style={styles.sectionDescription}>Research sources attached to this scan. Shared sightings should be corroborated before becoming established product facts.</Text>
          {sources.length ? sources.map((source, index) => (
            <View key={source.url + index} style={styles.source}>
              <Text style={styles.sourceTitle}>{source.title || source.source_type || "Research source"}</Text>
              <Text style={styles.sourceMeta}>{source.source_type || "SOURCE"} · SUPPORTS: {(source.supports || []).join(", ") || "not specified"}</Text>
              <Text style={styles.sourceUrl}>{source.url}</Text>
            </View>
          )) : <Text style={styles.missing}>No product research sources attached yet.</Text>}
        </View>
        <Text style={styles.footer}>Missing information is intentionally left blank until supported by a label, producer, appellation authority or corroborated evidence.</Text>
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
  missing:{color:"#68727D",fontSize:8,lineHeight:13,marginTop:6},
  source:{paddingVertical:8,borderTopWidth:1,borderTopColor:"rgba(153,163,174,0.10)"},
  sourceTitle:{color:C.ivory,fontSize:10,fontWeight:"800"},
  sourceMeta:{color:C.brass,fontSize:8,marginTop:3},
  sourceUrl:{color:C.muted,fontSize:8,marginTop:3},
  footer:{color:C.muted,fontSize:8,lineHeight:13,textAlign:"center",padding:12},
});
