import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { isBlockedInThisBuild } from './devOnlyRoutes';

// FIX-026: in production builds, cover and leave any developer-only screen.
// Rendered after the root <Stack /> so it sits on top of whatever screen is open.
export function DevRouteGuard() {
  const pathname = usePathname();
  const navState = useRootNavigationState();
  const blocked = isBlockedInThisBuild(pathname);

  useEffect(() => {
    if (blocked && navState?.key) router.replace('/');
  }, [blocked, navState?.key]);

  if (!blocked) return null;
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0D1117' }]} pointerEvents="auto" />;
}
