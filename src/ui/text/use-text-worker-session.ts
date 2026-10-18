import { useEffect, useState } from 'react';
import { createTextWorkerSession, type TextWorkerSession } from './text-worker-session';

/** One text worker session for the component's lifetime (ADR-616). */
export function useTextWorkerSession(): TextWorkerSession {
  const [session] = useState(() => createTextWorkerSession());
  useEffect(() => () => session.release(), [session]);
  return session;
}
