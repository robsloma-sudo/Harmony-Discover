import type { ComponentType } from 'react';
import { Redirect } from 'expo-router';

/**
 * FIX-026: wraps a developer-only screen so it only renders in development
 * builds (__DEV__). In production (Netlify web export and native release
 * builds) visitors are redirected home before the screen mounts, so none of
 * its hooks, camera sessions or Supabase calls run.
 */
export function devOnlyScreen<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function DevOnlyScreen(props: P) {
    if (!__DEV__) return <Redirect href="/" />;
    return <Screen {...props} />;
  }
  DevOnlyScreen.displayName = `DevOnly(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return DevOnlyScreen;
}
