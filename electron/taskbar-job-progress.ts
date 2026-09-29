// A running job on the Windows taskbar button (ADR-553): it fills with the
// job's progress, turns yellow while the job is held and red when it stopped
// on an error, and flashes when the job ends while KerfDesk is in the
// background. macOS fills the Dock icon the same way. The window reports the
// job through the activity route (session-end-guard.ts); this only draws it.

import {
  DESKTOP_JOB_ACTIVITY,
  type DesktopJobActivity,
  type DesktopJobReport,
} from './session-end-guard.js';

type ProgressBarMode = 'none' | 'normal' | 'indeterminate' | 'error' | 'paused';

export interface TaskbarWindow {
  setProgressBar(progress: number, options?: { mode: ProgressBarMode }): void;
  flashFrame(flag: boolean): void;
  isFocused(): boolean;
  isDestroyed(): boolean;
  once(event: 'focus' | 'closed', listener: () => void): unknown;
}

const MODES = { running: 'normal', paused: 'paused', error: 'error' } as const;

export function installTaskbarJobProgress(
  window: TaskbarWindow,
  activity: DesktopJobActivity = DESKTOP_JOB_ACTIVITY,
): void {
  let showing = false;
  const unsubscribe = activity.subscribe((report: DesktopJobReport) => {
    if (window.isDestroyed()) return;
    if (report.job !== undefined) {
      window.setProgressBar(report.job.progress, { mode: MODES[report.job.state] });
      showing = true;
      return;
    }
    if (!showing) return;
    showing = false;
    window.setProgressBar(-1);
    if (window.isFocused()) return;
    window.flashFrame(true);
    window.once('focus', () => {
      if (!window.isDestroyed()) window.flashFrame(false);
    });
  });
  window.once('closed', unsubscribe);
}
