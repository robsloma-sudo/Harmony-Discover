import { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useScan } from '../src/state/ScanContext';

export default function Scan() {
  const { addPages } = useScan();
  const [busy, setBusy] = useState(false);

  async function camera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'You can enable camera access in device settings, or choose photos instead.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled) { addPages(result.assets.map(a => a.uri), 'camera'); router.push('/preview'); }
  }
  async function gallery() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.85 });
    if (!result.canceled) { addPages(result.assets.map(a => a.uri), 'gallery'); router.push('/preview'); }
  }

  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <Text style={styles.eyebrow}>NEW OBSERVATION</Text>
      <Text style={styles.title}>Let’s see the menu.</Text>
      <Text style={styles.sub}>Capture the drinks you’re curious about. You can add more than one page.</Text>
      <Pressable style={styles.primary} onPress={camera}>
        <Text style={styles.primaryText}>Take a photo</Text>
        <Text style={styles.primaryHint}>Open your camera</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={gallery}>
        <Text style={styles.secondaryText}>Choose from photos</Text>
      </Pressable>
      <Text style={styles.footnote}>Photos stay on this device until you choose to process the scan.</Text>
    </Screen>
  );
}
