import { useEffect } from 'react';
import { RemoteRendererSession } from '../remote-access/renderer-session';

/** Mounted behind the existing desktop opening gates. Ordinary browsers never attach. */
export function useRemoteAccess(): void {
  useEffect(() => {
    if (location.protocol !== 'app:') return;
    const session = new RemoteRendererSession();
    void session.start();
    return () => session.stop();
  }, []);
}
