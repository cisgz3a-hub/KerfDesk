import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/components/App';
import { TrialGuard } from './ui/components/TrialGuard';
import { AppErrorBoundary } from './diagnostics/AppErrorBoundary';
import { installGlobalErrorHandlers } from './diagnostics/installGlobalErrorHandlers';
import { createCrashReporter } from './diagnostics/CrashReporter';

function readCrashDsn(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_LASERFORGE_CRASH_DSN ?? '';
}

function readAppVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-renderer';
}

const crashReporter = createCrashReporter({
  dsn: readCrashDsn(),
  appVersion: readAppVersion(),
  source: 'renderer',
});

installGlobalErrorHandlers({
  onReport: crashReporter.report,
});

const root = createRoot(document.getElementById('root')!);
root.render(
  React.createElement(AppErrorBoundary, {
    onCrash: crashReporter.report,
    children: React.createElement(TrialGuard, null,
      React.createElement(App),
    ),
  }),
);
