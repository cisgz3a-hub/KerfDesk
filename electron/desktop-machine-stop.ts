// Every network machine session the window can no longer reach gets its stop
// (rolling audit v11 W3-P1-1): the GRBL-family TCP sessions their reset, the
// Ruida UDP sessions Stop Process (ADR-697). Both go out together.

import type { MachineNetworkStop } from './machine-network-bridge.js';
import { stopDesktopMachineNetwork } from './machine-network-routes.js';
import { stopDesktopRuidaNetwork } from './ruida-network-routes.js';

export function stopDesktopMachines(immediate = false): Promise<MachineNetworkStop> {
  return Promise.all([stopDesktopMachineNetwork(immediate), stopDesktopRuidaNetwork()]).then(
    (stops) => ({
      sessions: stops.reduce((total, stop) => total + stop.sessions, 0),
      sent: stops.reduce((total, stop) => total + stop.sent, 0),
    }),
  );
}
