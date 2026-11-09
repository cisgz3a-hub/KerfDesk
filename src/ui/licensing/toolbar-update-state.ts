// What the toolbar's Update button shows for the desktop update status
// (ADR-561 Amendment 7). Pure, so the state-to-button mapping is tested on its
// own; ToolbarUpdateButton renders it and runs the existing update actions.

import type { CommercialUpdateStatus } from '../../platform/types';
import type { CommercialUpdateControls } from '../state/commercial-update-store';

/**
 * - `download`: an offered manual update; one click downloads it, or opens the
 *   verified download page on macOS and Linux (`page`).
 * - `downloading`: the download runs; `percent` is null before byte counts.
 * - `install`: a verified manual download; one click asks, then runs the
 *   guarded install-and-close (ADR-561 Amendment 3).
 * - `waiting`: as `install`, but machine work owns the window, so it cannot
 *   install now. Nothing closes by itself when the work ends.
 * - `on-close`: an update that installs when KerfDesk closes and has no
 *   install-now action (the signed lane); the click opens Check for Updates.
 * - `failed`: the user's own update action did not finish.
 */
export type ToolbarUpdateView =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'download'; readonly version: string; readonly page: boolean }
  | {
      readonly kind: 'downloading';
      readonly version: string;
      readonly percent: number | null;
      readonly verifying: boolean;
    }
  | { readonly kind: 'install'; readonly version: string }
  | { readonly kind: 'waiting'; readonly version: string }
  | {
      readonly kind: 'on-close';
      readonly version: string;
      /** Installs on a normal close: the signed lane, or an armed manual installer. */
      readonly onClose: boolean;
    }
  | { readonly kind: 'failed' };

export type ToolbarUpdateInput = {
  readonly status: CommercialUpdateStatus | null;
  readonly controls: CommercialUpdateControls | null;
  /** A job, Frame, motion or other machine work owns the window. */
  readonly machineBusy: boolean;
  /** The user clicked this button this session, so a failure is reported here. */
  readonly engaged: boolean;
};

const HIDDEN: ToolbarUpdateView = { kind: 'hidden' };

export function toolbarUpdateView(input: ToolbarUpdateInput): ToolbarUpdateView {
  const { status, controls } = input;
  if (status === null || controls === null) return HIDDEN;
  if (status.state === 'failed') return input.engaged ? { kind: 'failed' } : HIDDEN;
  const version = status.version;
  if (version === null) return HIDDEN;
  const manual = status.mode === 'manual';
  if (status.state === 'available')
    // Only a manual package is fetched from the app; the signed lane downloads itself.
    return manual && controls.download !== undefined
      ? { kind: 'download', version, page: status.delivery === 'download-page' }
      : HIDDEN;
  if (status.state === 'downloading')
    return { kind: 'downloading', version, ...downloadProgress(status) };
  return status.state === 'ready'
    ? readyView(status, controls, version, input.machineBusy)
    : HIDDEN;
}

function readyView(
  status: CommercialUpdateStatus,
  controls: CommercialUpdateControls,
  version: string,
  machineBusy: boolean,
): ToolbarUpdateView {
  const manual = status.mode === 'manual';
  if (!manual || controls.installAndClose === undefined)
    return { kind: 'on-close', version, onClose: !manual || status.installOnQuit === true };
  return { kind: machineBusy ? 'waiting' : 'install', version };
}

function downloadProgress(status: CommercialUpdateStatus): {
  readonly percent: number | null;
  readonly verifying: boolean;
} {
  const progress = status.downloadProgress;
  if (progress === undefined) return { percent: null, verifying: false };
  if (progress.phase === 'verifying') return { percent: 100, verifying: true };
  if (progress.phase === 'starting' || progress.totalBytes <= 0)
    return { percent: null, verifying: false };
  const percent = Math.floor((progress.receivedBytes / progress.totalBytes) * 100);
  return { percent: Math.min(99, Math.max(0, percent)), verifying: false };
}

/** The visible label, short enough for the toolbar. */
export function toolbarUpdateLabel(view: Exclude<ToolbarUpdateView, { kind: 'hidden' }>): string {
  switch (view.kind) {
    case 'download':
    case 'install':
      return 'Update';
    case 'downloading':
      if (view.verifying) return 'Verifying…';
      return view.percent === null ? 'Downloading…' : `Updating ${view.percent}%`;
    case 'waiting':
      return 'Update after job';
    case 'on-close':
      return 'Update ready';
    case 'failed':
      return 'Update failed';
  }
}

/** The hover and accessible description, naming the version. */
export function toolbarUpdateTitle(view: Exclude<ToolbarUpdateView, { kind: 'hidden' }>): string {
  switch (view.kind) {
    case 'download':
      return view.page
        ? `KerfDesk ${view.version} is available. Open its download page in your browser, then install it after you close KerfDesk.`
        : `KerfDesk ${view.version} is available. Download and verify it while you keep working; you choose when to install it.`;
    case 'downloading':
      return view.verifying
        ? `Verifying KerfDesk ${view.version}. Open Check for Updates for details.`
        : `Downloading KerfDesk ${view.version}${view.percent === null ? '' : `: ${view.percent}%`}. Open Check for Updates for details.`;
    case 'install':
      return `KerfDesk ${view.version} is ready. Install it now: KerfDesk asks about unsaved changes, then closes and opens the installer.`;
    case 'waiting':
      return `KerfDesk ${view.version} is ready. Machine work is running, so it cannot install now. Use Update again when the machine is idle; KerfDesk never closes by itself.`;
    case 'on-close':
      return view.onClose
        ? `KerfDesk ${view.version} installs when you close KerfDesk. Open Check for Updates.`
        : `KerfDesk ${view.version} has downloaded. Open Check for Updates to choose when it installs.`;
    case 'failed':
      return 'The update did not finish. Open Check for Updates for details.';
  }
}

/** Glows only while one click does something new: download or install. */
export function toolbarUpdateGlows(view: ToolbarUpdateView): boolean {
  return view.kind === 'download' || view.kind === 'install' || view.kind === 'on-close';
}
