import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { prefetchVisibleLines, type MenuLineLink } from '../services/menuExplore';
import { visibleLinkedLines, type LineBox } from './visibleLines';

/** Hook: wire `onScroll`/`onScreenLayout` into Screen and `onLineLayout(id)` into each line. Prefetches ~400 ms after scrolling settles and after links arrive. */
export function useVisibleLinePrefetch(links: MenuLineLink[], listOffset = 0) {
  const boxes = useRef<Record<string, LineBox>>({});
  const scrollY = useRef(0);
  const viewport = useRef(0);
  const offset = useRef(listOffset);
  const linksRef = useRef(links);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  linksRef.current = links;
  offset.current = listOffset;

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const visible = visibleLinkedLines(linksRef.current, boxes.current, scrollY.current, viewport.current, offset.current);
      if (visible.length) void prefetchVisibleLines(visible).catch(() => {});
    }, 400);
  }, []);

  useEffect(() => { if (links.length) schedule(); }, [links, schedule]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    if (e.nativeEvent.layoutMeasurement?.height) viewport.current = e.nativeEvent.layoutMeasurement.height;
    schedule();
  }, [schedule]);
  const onScreenLayout = useCallback((e: LayoutChangeEvent) => { viewport.current = e.nativeEvent.layout.height; schedule(); }, [schedule]);
  const onLineLayout = useCallback((id: string) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    boxes.current[id] = { y, height };
  }, []);
  return { onScroll, onScreenLayout, onLineLayout };
}
