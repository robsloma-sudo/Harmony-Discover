import Home from './index';

// Legacy Marty links now open the in-shell bottom panel, not a separate page.
export default function BartenderRoute() {
  return <Home initialPanel="marty" />;
}
