import { useEffect } from 'react';
import { RemoteRendererSession } from '../remote-access/renderer-session';
import { usePlatformOptional } from './platform-context';

/** Mounted behind the existing desktop opening gates. Ordinary browsers never attach. */
export function useRemoteAccess(): void {
  const platform = usePlatformOptional();
  useEffect(() => {
    if (location.protocol !== 'app:') return;
    const session = new RemoteRendererSession(platform);
    void session.start();
    return () => session.stop();
  }, [platform]);
}
