import { useEffect } from 'react';
import { useStore } from '../state';
import { forgetDiscoveredFalcon, registerFalconPointerBridge } from '../state/falcon-pointer-link';
import { useLaserStore } from '../state/laser-store';
import { usePlatformOptional } from './platform-context';

/** Give the Falcon pointer switch the platform's camera bridge (ADR-635). */
export function useFalconPointerLink(): void {
  const bridge = usePlatformOptional()?.cameraBridge;
  useEffect(() => {
    registerFalconPointerBridge(bridge);
    return () => registerFalconPointerBridge(undefined);
  }, [bridge]);
  // A Falcon found while connected to one machine, or with one machine
  // profile, need not be the next one: look for it again after either changes.
  const connection = useLaserStore((state) => state.connection.kind);
  const profileId = useStore((state) => state.project.device.profileId);
  const commandSet = useStore((state) => state.project.device.controllerCommandSet);
  useEffect(() => forgetDiscoveredFalcon(), [connection, profileId, commandSet]);
}
