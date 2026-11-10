import { Text } from 'react-native';
import { Screen, styles } from '../src/ui';
export default function Nearby() {
  return <Screen><Text style={styles.eyebrow}>DISCOVER AROUND YOU</Text><Text style={styles.title}>Nearby</Text><Text style={styles.sub}>Nearby menu discoveries will appear here when verified public observations and optional location permission are available.</Text></Screen>;
}
