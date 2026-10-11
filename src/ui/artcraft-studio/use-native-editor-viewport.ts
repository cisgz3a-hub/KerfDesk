import { useEffect, useRef } from 'react';
import { hideStudioEditor, hostStudioEditor, type StudioSession } from './artcraft-api';

/** Native windows sit inside this reserved rectangle; no HTML controls overlay it. */
export function useNativeEditorViewport(
  session: StudioSession | null,
  suspended: boolean,
  report: (message: string) => void,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    const element = viewport.current;
    if (session === null || element === null) return;
    let current = true;
    let pending = false;
    let again = false;
    const layout = async () => {
      if (!current || suspended) return;
      if (pending) {
        again = true;
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      pending = true;
      try {
        await hostStudioEditor(session.id, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      } catch (error) {
        if (current)
          reportRef.current(error instanceof Error ? error.message : 'Could not show editor');
      } finally {
        pending = false;
        if (!current || suspended) void hideStudioEditor(session.id).catch(() => undefined);
        else if (again) {
          again = false;
          void layout();
        }
      }
    };
    if (suspended) void hideStudioEditor(session.id).catch(() => undefined);
    else void layout();
    const observer = new ResizeObserver(() => {
      void layout();
    });
    observer.observe(element);
    window.addEventListener('resize', layout);
    return () => {
      current = false;
      observer.disconnect();
      window.removeEventListener('resize', layout);
      void hideStudioEditor(session.id).catch(() => undefined);
    };
  }, [session, suspended]);
  return viewport;
}
