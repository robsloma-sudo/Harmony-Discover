import { Text, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';

export default function Settings() {
  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back to camera</Text>
      <Text style={styles.eyebrow}>HARMONY DISCOVER</Text>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.sub}>Camera and discovery preferences.</Text>
      <View style={styles.item}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>Screen orientation</Text>
          <Text style={styles.categoryDesc}>Automatic — portrait and landscape supported</Text>
        </View>
        <Text style={styles.price}>AUTO</Text>
      </View>
      <View style={styles.item}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>Camera access</Text>
          <Text style={styles.categoryDesc}>Managed by your device privacy settings</Text>
        </View>
      </View>
      <View style={styles.item}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>Photo processing</Text>
          <Text style={styles.categoryDesc}>Photos are selected by you before processing</Text>
        </View>
      </View>
      <Text style={styles.footnote}>More preferences will appear here as the Discover experience is completed.</Text>
      <Pressable style={styles.primary} onPress={() => router.back()}>
        <Text style={styles.primaryText}>Return to camera</Text>
      </Pressable>
    </Screen>
  );
}
