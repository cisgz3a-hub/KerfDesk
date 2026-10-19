// Web + Electron entry point. Mounts the React tree into #app-root.
// The same web adapter serves both targets — Electron's Chromium renderer has
// the same Web Serial / File System Access / getUserMedia APIs (granted in
// electron/main.ts). We only stamp `id: 'electron'` for UI feature-gating.

import { StrictMode } from 'react';
import { resolveWindowsDesktopDownload } from '../../../public/desktop-windows-download.mjs';
import { DesktopDownloadContext } from '../licensing/desktop-download-context';
import { createRoot } from 'react-dom/client';
import {
  createDesktopPreviewUpdateAdapter,
  createDesktopLicenceAdapter,
  createDesktopProjectFiles,
  createDesktopJobActivityReporter,
  createDesktopSerialAdapter,
  createDesktopMachineNetwork,
  createDesktopAiAssistant,
  createDesktopSupportLogReader,
  createDesktopWindowCommands,
  isElectronRenderer,
} from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { ErrorBoundary, type SoftwareAbort } from '../common/ErrorBoundary';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { unownedControllerMotion } from '../state/unowned-controller-motion';
// Design tokens + shared chrome classes (ADR-047). Imported exactly once,
// here — jsdom tests never load main.tsx, so styling stays out of unit tests.
import '../theme/tokens.css';
import '../kit/icons.css';
import { initAppTheme } from '../theme/app-theme';
import { App } from './App';
import { PlatformProvider } from './platform-context';
import { EditionProvider } from '../licensing/EditionProvider';
import { installProjectSealKey } from '../licensing/project-seal';
import { startLicensedEditionLocked } from '../licensing/edition';
import { watchPreloadErrors } from './preload-error-toast';
import { DesktopStartupGate } from './DesktopStartupGate';
import { WorkspaceAssetLifecycle } from './WorkspaceAssetLifecycle';
import { dismissStartupSplash } from './startup-splash';

const rootElement = document.getElementById('app-root');
if (rootElement === null) {
  throw new Error('Root element #app-root not found in index.html.');
}

// Stamp the saved theme on <html> BEFORE the first render, so the chrome never
// paints a frame in one theme and then flips (ADR-339).
initAppTheme();

// Before anything lazy loads: a chunk gone after an update in another window
// gets one advisory toast, and nothing reloads by itself (ADR-060).
watchPreloadErrors();

// Reuse every web-adapter method; override `id` so the UI can hide the
// browser-only PWA install + desktop-download affordances inside the app. The
// desktop app also reopens files Explorer handed over, by path (ADR-378).
const adapter: PlatformAdapter = isElectronRenderer()
  ? {
      ...webAdapter,
      id: 'electron',
      serial: createDesktopSerialAdapter(webAdapter.serial),
      desktopUpdates: createDesktopPreviewUpdateAdapter(),
      ...createDesktopProjectFiles(webAdapter.recentFiles, {
        handleSaveTarget: webAdapter.openedProjectSaveTarget,
      }),
      // The main process serves its support log (ADR-546), takes job reports
      // (ADR-548) and runs File > Exit (ADR-554) only on app://.
      ...(window.location.protocol === 'app:'
        ? {
            readSupportLog: createDesktopSupportLogReader(),
            reportJobActivity: createDesktopJobActivityReporter(),
            desktopWindow: createDesktopWindowCommands(),
            aiAssistant: createDesktopAiAssistant(),
            machineNetwork: createDesktopMachineNetwork(),
          }
        : {}),
    }
  : webAdapter;
const desktopLicenceClient =
  adapter.id === 'electron' && window.location.protocol === 'app:'
    ? createDesktopLicenceAdapter()
    : undefined;
// Before any project opens or saves: seals tell this computer's Pro work apart (ADR-592).
const sealKey = desktopLicenceClient?.projectSealKey;
if (sealKey !== undefined) installProjectSealKey(sealKey);
if (desktopLicenceClient !== undefined) startLicensedEditionLocked();

// If a render crash unmounts the App (and its Abort button + Ctrl+. listener),
// the crash screen still needs a way to request a controller abort (F60/F65). Both
// closures read the store at call time, so they reflect the machine's real state
// at the moment of the crash / click.
const softwareAbort: SoftwareAbort = {
  isMotionLive: () => {
    const s = useLaserStore.getState();
    return (
      isActiveJob(s.streamer) ||
      s.controllerOperation !== null ||
      s.motionOperation !== null ||
      s.fireActive ||
      unownedControllerMotion(s) !== null
    );
  },
  trigger: () =>
    void useLaserStore
      .getState()
      .stopJob()
      .catch(() => undefined),
};

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary softwareAbort={softwareAbort}>
      <PlatformProvider adapter={adapter}>
        <DesktopStartupGate>
          <DesktopDownloadContext.Provider value={resolveWindowsDesktopDownload}>
            <EditionProvider
              {...(import.meta.env.DEV &&
              (import.meta.env.MODE === 'desktop' || import.meta.env.MODE === 'test')
                ? { unlicensedRunsFree: false }
                : {})}
              {...(desktopLicenceClient === undefined ? {} : { client: desktopLicenceClient })}
            >
              <WorkspaceAssetLifecycle />
              <App />
            </EditionProvider>
          </DesktopDownloadContext.Provider>
        </DesktopStartupGate>
      </PlatformProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Static timber and branding paint together before JS. Hold from the first
// startup frame in both editions, excluding time the document is hidden.
dismissStartupSplash({ desktop: adapter.id === 'electron' });
