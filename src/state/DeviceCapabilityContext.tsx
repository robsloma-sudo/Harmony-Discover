import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import {
  createScannerCapabilityProfile,
  getDiscoverARKitCapabilities,
  type ARKitCapabilities,
  type ScannerCapabilityProfile,
} from '../services/discoverARKit';

type DeviceCapabilityState = {
  loading: boolean;
  capabilities: ARKitCapabilities | null;
  profile: ScannerCapabilityProfile;
  error: string;
  refresh: () => Promise<void>;
};

const fallbackProfile = createScannerCapabilityProfile(null);
const DeviceCapabilityContext = createContext<DeviceCapabilityState | null>(null);

export function DeviceCapabilityProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<ARKitCapabilities | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getDiscoverARKitCapabilities();
      setCapabilities(result);
      if (Platform.OS === 'ios' && !result) {
        setError('Native ARKit module unavailable. Smart Scan remains enabled.');
      }
    } catch (cause) {
      setCapabilities(null);
      setError(cause instanceof Error ? cause.message : 'Device capability detection failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const profile = useMemo(
    () => createScannerCapabilityProfile(capabilities),
    [capabilities],
  );

  const value = useMemo(
    () => ({ loading, capabilities, profile, error, refresh }),
    [loading, capabilities, profile, error, refresh],
  );

  return (
    <DeviceCapabilityContext.Provider value={value}>
      {children}
    </DeviceCapabilityContext.Provider>
  );
}

export function useDeviceCapabilities() {
  const value = useContext(DeviceCapabilityContext);
  if (!value) throw new Error('DeviceCapabilityProvider missing');
  return value;
}
