import { useEffect } from 'react';
import { registerFalconPointerBridge } from '../state/falcon-pointer-link';
import { usePlatformOptional } from './platform-context';

/** Give the Falcon pointer switch the platform's camera bridge (ADR-635). */
export function useFalconPointerLink(): void {
  const bridge = usePlatformOptional()?.cameraBridge;
  useEffect(() => {
    registerFalconPointerBridge(bridge);
    return () => registerFalconPointerBridge(undefined);
  }, [bridge]);
}
