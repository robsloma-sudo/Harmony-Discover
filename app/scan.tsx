import { Text, Pressable, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useScan } from '../src/state/ScanContext';

export default function Scan() {
  const { appendPages, pages } = useScan();
  const remainingPages = Math.max(0, 12 - pages.length);

  async function camera() {
    if (remainingPages < 1) { Alert.alert('Page limit reached', 'A menu scan can contain up to 12 pages. Remove a page from the review screen to add another.'); return; }
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
    if (remainingPages < 1) { Alert.alert('Page limit reached', 'A menu scan can contain up to 12 pages. Remove a page from the review screen to add another.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.min(10, remainingPages), quality: 0.85 });
    if (!result.canceled && result.assets.length) {
      if (result.assets.length > remainingPages) { Alert.alert('Too many pages selected', `You can add ${remainingPages} more page${remainingPages === 1 ? '' : 's'} to this scan.`); return; }
      appendPages(result.assets.map(a => a.uri), 'gallery');
      router.replace('/preview');
    }
  }

  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <Text style={styles.eyebrow}>{pages.length ? `MENU SCAN · ${pages.length} / 12 PAGES SELECTED` : 'MENU SCAN · UP TO 12 PAGES'}</Text>
      <Text style={styles.title}>{pages.length ? 'Add another page.' : 'Capture a menu.'}</Text>
      <Text style={styles.sub}>{pages.length ? 'Capture another side of the menu or select more photos. Your current pages will stay in this scan.' : 'Take a photo of the menu or choose images from your library. You can review everything before uploading.'}</Text>
      <Pressable style={styles.primary} onPress={camera}>
        <Text style={styles.primaryText}>{pages.length ? 'Take another photo' : 'Take a photo'}</Text>
        <Text style={styles.primaryHint}>{pages.length ? 'Add a camera capture' : 'Capture a menu page'}</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={gallery}>
        <Text style={styles.secondaryText}>{pages.length ? 'Add from photos' : 'Choose from photos'}</Text>
      </Pressable>
      <Text style={styles.footnote}>{pages.length ? 'Photos remain on this device until you choose to process the scan.' : 'Photos stay on this device until you choose to process the scan.'}</Text>
    </Screen>
  );
}
