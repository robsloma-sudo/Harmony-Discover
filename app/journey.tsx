import { Text, View, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { getMockJourney } from '../src/services/mockJourneyApi';

export default function Journey() {
  const { itemId } = useLocalSearchParams<{itemId:string}>();
  const journey = getMockJourney(itemId || 'paper-plane');
  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Menu</Text>
      <Text style={styles.eyebrow}>YOUR JOURNEY</Text>
      <Text style={styles.title}>{journey.title}</Text>
      <Text style={styles.sub}>{journey.intro}</Text>
      {journey.sections.map((section: { heading: string; body: string; evidence: string }) => (
        <View key={section.heading} style={styles.journeySection}>
          <Text style={styles.sectionTitle}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
          <Text style={styles.evidence}>{section.evidence}</Text>
        </View>
      ))}
      <Pressable style={styles.primary} onPress={() => router.push('/collection')}>
        <Text style={styles.primaryText}>Save this discovery</Text>
      </Pressable>
    </Screen>
  );
}
