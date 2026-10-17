import { useEffect, useRef, useState } from 'react';
import { loadJigTraceSource, type JigTraceSource } from './jig-trace-import';

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

  const load = async (file: File): Promise<void> => {
    const ticket = ++request.current;
    setSource(null);
    setError(null);
    setLoading(true);
    try {
      const next = await loadJigTraceSource(file);
      if (ticket === request.current) setSource(next);
    } catch (reason) {
      if (ticket === request.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  };
  return { source, loading, error, load };
}
