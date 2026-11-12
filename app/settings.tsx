import Home from './index';

// Legacy deep links now resolve to the permanent camera shell with Settings opened in place.
export default function SettingsRoute() {
  return <Home initialPanel="settings" />;
}
