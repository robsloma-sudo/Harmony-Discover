import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScanProvider } from '../src/state/ScanContext';
import { AuthProvider } from '../src/auth/AuthContext';
import { DeviceCapabilityProvider } from '../src/state/DeviceCapabilityContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <DeviceCapabilityProvider>
      <ScanProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0D1117' } }} />
      </ScanProvider>
      </DeviceCapabilityProvider>
    </AuthProvider>
  );
}
