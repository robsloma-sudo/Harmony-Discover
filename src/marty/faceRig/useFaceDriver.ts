// React helpers for the option A face driver.
import { useEffect, useState } from 'react';
import { createFaceDriver, type FaceDriver } from './faceDriver';

/** One driver for the life of the screen; disposed on unmount. */
export function useFaceDriver(): FaceDriver {
  const [driver] = useState<FaceDriver>(() => createFaceDriver());
  useEffect(() => () => driver.dispose(), [driver]);
  return driver;
}

/** True while the driver hears Marty's voice (re-renders only when it flips). */
export function useDriverTalking(driver: FaceDriver | null): boolean {
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (!driver) { setTalking(false); return; }
    setTalking(driver.current().talking);
    return driver.subscribe(p => setTalking(prev => (prev === p.talking ? prev : p.talking)));
  }, [driver]);
  return talking;
}
