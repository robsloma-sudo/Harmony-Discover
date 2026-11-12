import Home from './index';

// Nearby is an in-shell drop-up; keep the camera viewfinder mounted.
export default function NearbyRoute() {
  return <Home initialPanel="nearby" />;
}
