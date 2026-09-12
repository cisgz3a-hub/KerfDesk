import { useEffect, useRef, useState } from 'react';
import { PreviewBitmapRenderer } from './preview-bitmap-renderer';

export function usePreviewBitmapRenderer(enabled: boolean) {
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const ref = useRef<PreviewBitmapRenderer | null>(null);
  if (ref.current === null) {
    ref.current = new PreviewBitmapRenderer((updating, repaint) => {
      setPending(updating);
      if (repaint) setRevision((current) => current + 1);
    });
  }
  const renderer = ref.current;
  useEffect(() => {
    setPending(false);
    if (!enabled) renderer.clear();
    return () => renderer.clear(false);
  }, [enabled, renderer]);
  return { drawRoute: renderer.draw, pending, revision };
}
