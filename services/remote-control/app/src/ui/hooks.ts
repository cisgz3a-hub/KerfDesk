import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, type AppState } from '../core/store';

/** Subscribe to one slice of the app store. Selectors must return stable references. */
export function useApp<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** Text field draft that survives refreshes and only reports parsed values on commit. */
export function useDraft(value: string): [string, (next: string) => void, () => void] {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  return [
    draft,
    (next) => {
      dirty.current = true;
      setDraft(next);
    },
    () => {
      dirty.current = false;
    },
  ];
}

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

export function useElementSize<T extends HTMLElement>(): [
  React.RefObject<T>,
  { width: number; height: number },
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
