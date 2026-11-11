import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';

// The live scanner currently runs in the web build (app/bottles.web.tsx).
// The installed iPhone build gets its own on-device version next.
export default function Live() {
  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <Text style={styles.eyebrow}>LIVE SCAN</Text>
      <Text style={styles.title}>Open Discover in your browser.</Text>
      <Text style={styles.sub}>Live scanning runs in the web version for now. The app version is on its way.</Text>
    </Screen>
  );
}
