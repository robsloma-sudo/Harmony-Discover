import { Text, Pressable, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useScan } from '../src/state/ScanContext';

export default function Scan() {
  const { appendPages, pages } = useScan();

  async function camera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'You can enable camera access in device settings, or choose photos instead.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets.length) {
      appendPages(result.assets.map(a => a.uri), 'camera');
      router.replace('/preview');
    }
  }

  async function gallery() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.85 });
    if (!result.canceled && result.assets.length) {
      appendPages(result.assets.map(a => a.uri), 'gallery');
      router.replace('/preview');
    }
  }

  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <Text style={styles.eyebrow}>MENU SCAN · {pages.length} PAGE{pages.length === 1 ? '' : 'S'} SELECTED</Text>
      <Text style={styles.title}>Add another page.</Text>
      <Text style={styles.sub}>Capture another side of the menu or select more photos. Your current pages will stay in this scan.</Text>
      <Pressable style={styles.primary} onPress={camera}>
        <Text style={styles.primaryText}>Take another photo</Text>
        <Text style={styles.primaryHint}>Add a camera capture</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={gallery}>
        <Text style={styles.secondaryText}>Add from photos</Text>
      </Pressable>
      <Text style={styles.footnote}>Photos remain on this device until you choose to process the scan.</Text>
    </Screen>
  );
}
