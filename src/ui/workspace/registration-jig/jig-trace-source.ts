import { useEffect, useRef, useState } from 'react';
import type { RasterImage, SceneObject } from '../../../core/scene';
import {
  loadJigImageTraceSource,
  loadJigTraceSource,
  type JigTraceSource,
} from './jig-trace-import';

export function useJigTraceSource() {
  const [source, setSource] = useState<JigTraceSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  // The newest request wins: an older upload or image finishing last is dropped.
  const loadFrom = async (read: () => Promise<JigTraceSource>): Promise<void> => {
    const ticket = ++request.current;
    setSource(null);
    setError(null);
    setLoading(true);
    try {
      const next = await read();
      if (ticket === request.current) setSource(next);
    } catch (reason) {
      if (ticket === request.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  };
  const load = (file: File): Promise<void> => loadFrom(() => loadJigTraceSource(file));
  const loadImage = (image: RasterImage, maskObject: SceneObject | undefined): Promise<void> =>
    loadFrom(() => loadJigImageTraceSource(image, maskObject));
  return { source, loading, error, load, loadImage };
}
