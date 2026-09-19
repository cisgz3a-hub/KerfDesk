import { grblDriver } from '../../core/controllers';
import type { LaserState } from './laser-store';

export function initialControllerConnectionState(): Pick<
  LaserState,
  | 'capabilities'
  | 'activeControllerKind'
  | 'activeControllerCommandSet'
  | 'detectedControllerKind'
  | 'connection'
  | 'serialPortInfo'
  | 'statusReport'
> {
  return {
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    activeControllerCommandSet: null,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    serialPortInfo: null,
    statusReport: null,
  };
}
