// FIX-026: developer/test screens that must never be reachable in a production build.
// In development builds (__DEV__ === true) they stay available for testing.
// To make a screen public again, remove it from this list (and from netlify.toml).
export const DEV_ONLY_ROUTES: readonly string[] = [
  '/comedy-lab',
  '/learning-console',
  '/bartender-settings',
  '/arkit-diagnostics',
  '/arkit-live-test',
];

function normalize(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  const path = pathname.split(/[?#]/)[0].replace(/\.html$/i, '').replace(/\/+$/, '');
  return (path || '/').toLowerCase();
}

export function isDevOnlyRoute(pathname: string | null | undefined): boolean {
  return DEV_ONLY_ROUTES.includes(normalize(pathname));
}

export function isBlockedInThisBuild(pathname: string | null | undefined, isDev: boolean = __DEV__): boolean {
  return !isDev && isDevOnlyRoute(pathname);
}
