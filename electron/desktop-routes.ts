import { withDesktopWindowCommands } from './desktop-window-commands.js';
import { withDesktopActivityRoute } from './session-end-guard.js';
import { withSupportRoutes } from './support-routes.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { withDesktopAi } from './desktop-ai.js';
import { withMachineNetworkRoutes } from './machine-network-routes.js';

/** Keep existing window/activity/support guards in their original outer order. */
export function withDesktopWorkspaceRoutes(
  fallback: ProtocolHandler,
  supportLog: Parameters<typeof withSupportRoutes>[1],
  userDataPath?: string,
): ProtocolHandler {
  const routes = userDataPath === undefined ? fallback : withDesktopAi(fallback, userDataPath);
  return withDesktopWindowCommands(
    withDesktopActivityRoute(withSupportRoutes(withMachineNetworkRoutes(routes), supportLog)),
  );
}
