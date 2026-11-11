import { Text, View, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { getMockJourney } from '../src/services/mockJourneyApi';

export default function Journey() {
  const { itemId, source, entityType, title, brand, expression, category, proof, size, section, description, price } = useLocalSearchParams<{itemId:string;source?:string;entityType?:string;title?:string;brand?:string;expression?:string;category?:string;proof?:string;size?:string;section?:string;description?:string;price?:string}>();
  const journey = getMockJourney(itemId || 'paper-plane');
  const isDiscoverHandoff = source === 'discover';
  const displayTitle = typeof title === 'string' && title.trim() ? title : journey.title;
  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  {isDiscoverHandoff ? 'Back to scan' : 'Menu'}</Text>
      <Text style={styles.eyebrow}>{isDiscoverHandoff ? 'DISCOVERED ITEM' : 'YOUR JOURNEY'}</Text>
      <Text style={styles.title}>{displayTitle}</Text>
      <Text style={styles.sub}>{isDiscoverHandoff ? 'A discovery captured in Harmony Discover. Review the extracted evidence here, then continue into the wider Harmony learning experience.' : journey.intro}</Text>
      {isDiscoverHandoff && <View style={{marginTop:8,padding:15,borderWidth:1,borderColor:'#C6A36A55',borderRadius:14,gap:8,backgroundColor:'#111820'}}>
        <Text style={styles.eyebrow}>DISCOVER SCAN · {String(entityType || 'BEVERAGE').replace('_',' ').toUpperCase()}</Text>
        {!!brand && <Text style={styles.itemTitle}>{brand}</Text>}
        {!!expression && <Text style={styles.categoryDesc}>{expression}</Text>}
        {!!category && <Text style={styles.categoryDesc}>Category · {category}</Text>}
        {!!section && <Text style={styles.categoryDesc}>Menu section · {section}</Text>}
        {!!description && <Text style={styles.categoryDesc}>{description}</Text>}
        {!!price && <Text style={styles.categoryDesc}>Printed price · {price}</Text>}
        {!!proof && <Text style={styles.categoryDesc}>Proof / strength · {proof}</Text>}
        {!!size && <Text style={styles.categoryDesc}>Package size · {size}</Text>}
        <Text style={styles.evidence}>Source: user-initiated Discover scan. Extracted details are observations, not automatically verified canonical records.</Text>
        <Text style={styles.evidence}>Journeys handoff is pending. The current Journeys player requires an initialized journey context from its host, and Discover does not yet have a supported cross-app launch contract. This scan remains in Discover; nothing is sent to or published by Journeys.</Text>
      </View>}
      {isDiscoverHandoff ? <View style={{padding:15,borderWidth:1,borderColor:'#303741',borderRadius:14,gap:8}}>
        <Text style={styles.sectionTitle}>Journey research</Text>
        <Text style={styles.body}>The scanned item is carried into this Discover handoff as source context. Product-specific stories, maps, producer research and chapters will appear here when Harmony Journeys exposes a supported item-level link. No unverified story is generated from the scan alone.</Text>
        <Text style={styles.evidence}>Current connection: opens the Harmony Journeys home experience. Item-level deep linking is not yet implemented.</Text>
      </View> : journey.sections.map((section: { heading: string; body: string; evidence: string }) => (
        <View key={section.heading} style={styles.journeySection}>
          <Text style={styles.sectionTitle}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
          <Text style={styles.evidence}>{section.evidence}</Text>
        </View>
      ))}
      {!isDiscoverHandoff && <Pressable style={styles.primary} onPress={() => router.push('/collection')}>
        <Text style={styles.primaryText}>Save this discovery</Text>
      </Pressable>}
    </Screen>
  );
}
