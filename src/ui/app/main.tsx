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
  desktopCameraBridgeConnection,
  createDesktopSupportLogReader,
  createDesktopWindowCommands,
  isElectronRenderer,
} from '../../platform/electron';
import type { PlatformAdapter } from '../../platform/types';
import { webAdapter } from '../../platform/web';
import { createHttpCameraBridge } from '../../platform/web/camera-bridge';
import { ErrorBoundary } from '../common/ErrorBoundary';
// Design tokens + shared chrome classes (ADR-047). Imported exactly once,
// here — jsdom tests never load main.tsx, so styling stays out of unit tests.
import '../theme/tokens.css';
import '../kit/icons.css';
import { initAppTheme } from '../theme/app-theme';
import { App } from './App';
import { CrashScreenHosts, machineSoftwareAbort, projectCrashSave } from './crash-recovery';
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
      // (ADR-548), runs File > Exit (ADR-554) and hands over the camera
      // bridge's keys (ADR-141 Amendment 2) only on app://.
      ...(window.location.protocol === 'app:'
        ? {
            readSupportLog: createDesktopSupportLogReader(),
            reportJobActivity: createDesktopJobActivityReporter(),
            desktopWindow: createDesktopWindowCommands(),
            aiAssistant: createDesktopAiAssistant(),
            machineNetwork: createDesktopMachineNetwork(),
            cameraBridge: createHttpCameraBridge(() => desktopCameraBridgeConnection()),
          }
        : {}),
    }
  : webAdapter;
const desktopLicenceClient =
  adapter.id === 'electron' && window.location.protocol === 'app:'
    ? createDesktopLicenceAdapter()
    : undefined;
if (desktopLicenceClient !== undefined) startLicensedEditionLocked();

function prepareDesktopWorkspace(): void {
  // Native licensing routes open at the ready handshake. Start the key load
  // before project providers mount; project IO waits for it, not the workspace.
  const sealKey = desktopLicenceClient?.projectSealKey;
  if (sealKey !== undefined) installProjectSealKey(sealKey);
}

// App puts the workspace in its own boundary, so a crash there keeps the job
// protections running (audit 27-P2-2). This root boundary catches the rest:
// the providers, the startup gate and those protections themselves. It still
// offers the software Abort (F60/F65) and Save.
createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary
      softwareAbort={machineSoftwareAbort}
      crashSave={projectCrashSave(adapter)}
      crashHosts={<CrashScreenHosts />}
    >
      <PlatformProvider adapter={adapter}>
        <DesktopStartupGate onNativeReady={prepareDesktopWorkspace}>
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
