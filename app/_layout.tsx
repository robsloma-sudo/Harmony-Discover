import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScanProvider } from '../src/state/ScanContext';
import { AuthProvider } from '../src/auth/AuthContext';
import { DeviceCapabilityProvider } from '../src/state/DeviceCapabilityContext';
import { DevRouteGuard } from '../src/dev/DevRouteGuard';

export default function RootLayout() {
  return (
    <AuthProvider>
      <DeviceCapabilityProvider>
      <ScanProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0D1117' } }} />
        <DevRouteGuard />
      </ScanProvider>
      </DeviceCapabilityProvider>
    </AuthProvider>
  );
}
