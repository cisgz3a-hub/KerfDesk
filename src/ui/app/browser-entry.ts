import { openBrowserEntry, type BrowserEntryEnvironment } from './browser-entry-policy';
import { showWorkspaceStartupError } from './workspace-startup-error';
import { loadDevelopmentWorkspace } from './development-workspace-entry';

const environment: BrowserEntryEnvironment = {
  protocol: window.location.protocol,
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
  coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  screenWidth: window.screen.width,
  screenHeight: window.screen.height,
};

// Decide before importing the workspace, its stores, or machine integrations.
// Only startup is routed: resizing a desktop window never unmounts a live job.
void openBrowserEntry(environment, {
  openLicencePage: () => window.location.replace('/buy.html'),
  openWorkspace: () =>
    import.meta.env.DEV ? loadDevelopmentWorkspace(document) : import('./main'),
  onWorkspaceError: () => showWorkspaceStartupError(document, () => window.location.reload()),
});
