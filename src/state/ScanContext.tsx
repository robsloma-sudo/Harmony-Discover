import { createContext, useContext, useState, ReactNode } from 'react';
type ScanContextValue = { pages: string[]; source: 'camera' | 'gallery'; addPages: (uris: string[], source?: 'camera' | 'gallery') => void; clear: () => void };
const Context = createContext<ScanContextValue | null>(null);
export function ScanProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<string[]>([]);
  const [source, setSource] = useState<'camera' | 'gallery'>('camera');
  return <Context.Provider value={{ pages, source, addPages: (uris, from = 'camera') => { setSource(from); setPages(old => [...old, ...uris]); }, clear: () => setPages([]) }}>{children}</Context.Provider>;
}
export function useScan() { const value = useContext(Context); if (!value) throw new Error('ScanProvider missing'); return value; }
