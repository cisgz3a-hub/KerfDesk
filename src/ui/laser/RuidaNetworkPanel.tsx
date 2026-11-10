// Machine details entry for a Ruida reached over the network (ADR-697). It
// mounts only on the desktop (browsers have no UDP) for a driver whose
// datagramNetwork capabilities list the link, and loads the panel body lazily
// so none of the link's code joins the boot bundle. .rd export is unchanged.

import { lazy, Suspense } from 'react';
import { selectControllerDriver } from '../../core/controllers';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';

const RuidaNetworkDetails = lazy(() => import('../ruida-network/RuidaNetworkDetails'));

export function RuidaNetworkPanel(): JSX.Element | null {
  const platform = usePlatform();
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const network = platform.ruidaNetwork;
  if (network === undefined || selectControllerDriver(controllerKind).datagramNetwork === undefined)
    return null;
  return (
    <Suspense fallback={null}>
      <RuidaNetworkDetails network={network} />
    </Suspense>
  );
}
