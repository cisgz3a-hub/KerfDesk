import { withDesktopWindowCommands } from './desktop-window-commands.js';
import { withDesktopActivityRoute } from './session-end-guard.js';
import { withSupportRoutes } from './support-routes.js';
import type { ProtocolHandler } from './licensing-routes.js';

/** Keep existing window/activity/support guards in their original outer order. */
export function withDesktopWorkspaceRoutes(
  fallback: ProtocolHandler,
  supportLog: Parameters<typeof withSupportRoutes>[1],
): ProtocolHandler {
  return withDesktopWindowCommands(
    withDesktopActivityRoute(withSupportRoutes(fallback, supportLog)),
  );
}
