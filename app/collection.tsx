import { Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
export default function Collection() {
  return <Screen>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/')}><Text style={styles.back}>‹  Back to Discover</Text></Pressable>
    <Text style={styles.eyebrow}>YOUR LIBRARY</Text><Text style={styles.title}>My collection</Text>
    <Text style={styles.sub}>Your saved drinks and Journeys will live here. Account sync is not connected in this prototype.</Text>
    <Text style={styles.sectionTitle}>Your discoveries</Text>
    <Text style={styles.categoryDesc}>Your library is ready for saved discoveries. Saving and cross-device sync are not enabled yet.</Text>
  </Screen>;
}