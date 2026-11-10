import { createContext, useContext, useState, ReactNode } from 'react';

type ScanContextValue = {
  pages: string[];
  source: 'camera' | 'gallery';
  addPages: (uris: string[], source?: 'camera' | 'gallery') => void;
  appendPages: (uris: string[], source?: 'camera' | 'gallery') => void;
  clear: () => void;
};

const Context = createContext<ScanContextValue | null>(null);

export function ScanProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<string[]>([]);
  const [source, setSource] = useState<'camera' | 'gallery'>('camera');

  return (
    <Context.Provider
      value={{
        pages,
        source,
        // A capture or gallery selection starts a fresh scan. Keeping old URIs
        // here can silently mix photos from a previous, abandoned preview.
        addPages: (uris, from = 'camera') => {
          setSource(from);
          setPages([...uris]);
        },
        appendPages: (uris, from = 'camera') => {
          setSource(current => current === from ? current : from);
          setPages(old => [...old, ...uris]);
        },
        clear: () => {
          setPages([]);
          setSource('camera');
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useScan() {
  const value = useContext(Context);
  if (!value) throw new Error('ScanProvider missing');
  return value;
}
