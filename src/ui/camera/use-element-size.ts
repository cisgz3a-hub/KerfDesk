import { useRef, useState } from 'react';

export type ElementSize = { readonly width: number; readonly height: number };

/** Measure a canvas-area sibling without coupling camera code to Workspace. */
export function useElementSize(): [ElementSize | null, (node: HTMLDivElement | null) => void] {
  const [size, setSize] = useState<ElementSize | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const setNode = (node: HTMLDivElement | null): void => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node === null) return;
    const apply = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      setSize((current) => nextSize(current, rect.width, rect.height));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    observerRef.current = observer;
  };
  return [size, setNode];
}

function nextSize(current: ElementSize | null, width: number, height: number): ElementSize {
  return current !== null && current.width === width && current.height === height
    ? current
    : { width, height };
}
