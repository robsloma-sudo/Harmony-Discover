import { Text } from 'react-native';
import { Screen, styles } from '../src/ui';
export default function Collection() {
  return <Screen><Text style={styles.eyebrow}>YOUR LIBRARY</Text><Text style={styles.title}>My collection</Text><Text style={styles.sub}>Your saved drinks and Journeys will live here. Account sync is not connected in this prototype.</Text></Screen>;
}
