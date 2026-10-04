import { RendererMachineGrants } from './renderer-machine-grants';
import type { RemoteAccessStatus } from './remote-access-store';

/** Grant lifetime is independent of a completed machine command RPC. */
export function createRendererMachineAuthorities(
  owns: (session: string) => boolean,
  status: () => RemoteAccessStatus | null,
) {
  return new RendererMachineGrants(owns, status);
}
