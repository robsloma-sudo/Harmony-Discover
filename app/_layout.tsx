import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScanProvider } from '../src/state/ScanContext';
import { AuthProvider } from '../src/auth/AuthContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <ScanProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0D1117' } }} />
      </ScanProvider>
    </AuthProvider>
  );
}
