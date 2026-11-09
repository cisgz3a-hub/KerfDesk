import { describe, expect, it } from 'vitest';
import type { CommercialUpdateStatus } from '../../platform/types';
import type { CommercialUpdateControls } from '../state/commercial-update-store';
import {
  toolbarUpdateGlows,
  toolbarUpdateLabel,
  toolbarUpdateTitle,
  toolbarUpdateView,
  type ToolbarUpdateInput,
} from './toolbar-update-state';

const action = async (): Promise<void> => undefined;
const controls: CommercialUpdateControls = {
  busy: false,
  feedback: null,
  panelOpen: false,
  download: action,
  installOnQuit: action,
  installAndClose: action,
};

function manual(
  state: CommercialUpdateStatus['state'],
  extra: Partial<CommercialUpdateStatus> = {},
): CommercialUpdateStatus {
  return {
    state,
    currentVersion: '1.0.30',
    version: '1.0.31',
    checkedAt: null,
    mode: 'manual',
    installOnQuit: false,
    ...extra,
  };
}

/** The signed lane: no manual mode, installs when KerfDesk closes. */
function signed(state: CommercialUpdateStatus['state']): CommercialUpdateStatus {
  return { state, currentVersion: '1.0.30', version: '1.0.31', checkedAt: null };
}

function view(status: CommercialUpdateStatus | null, extra: Partial<ToolbarUpdateInput> = {}) {
  return toolbarUpdateView({ status, controls, machineBusy: false, engaged: false, ...extra });
}

describe('toolbar Update button state (ADR-561 Amendment 7)', () => {
  it('stays hidden without an offered or downloaded version', () => {
    expect(view(null).kind).toBe('hidden');
    expect(view(manual('available'), { controls: null }).kind).toBe('hidden');
    for (const state of ['idle', 'checking', 'up-to-date', 'not-covered', 'unavailable'] as const)
      expect(view(manual(state)).kind).toBe('hidden');
    expect(view(manual('ready', { version: null })).kind).toBe('hidden');
    // A failure shows only after the user acted on the button.
    expect(view(manual('failed')).kind).toBe('hidden');
    expect(view(manual('failed'), { engaged: true }).kind).toBe('failed');
  });

  it('downloads an offered manual update, or opens the page on macOS and Linux', () => {
    expect(view(manual('available'))).toEqual({ kind: 'download', version: '1.0.31', page: false });
    expect(view(manual('available', { delivery: 'download-page' }))).toEqual({
      kind: 'download',
      version: '1.0.31',
      page: true,
    });
    // The signed lane downloads itself; nothing to click until it is ready.
    expect(view(signed('available')).kind).toBe('hidden');
    expect(view(manual('available'), { controls: { ...controls, download: undefined } }).kind).toBe(
      'hidden',
    );
  });

  it('reports download progress in the label', () => {
    const downloading = (receivedBytes: number, phase: 'starting' | 'receiving' | 'verifying') =>
      view(manual('downloading', { downloadProgress: { phase, receivedBytes, totalBytes: 200 } }));
    const label = (value: ReturnType<typeof view>) =>
      value.kind === 'hidden' ? '' : toolbarUpdateLabel(value);
    expect(label(view(manual('downloading')))).toBe('Downloading…');
    expect(label(downloading(0, 'starting'))).toBe('Downloading…');
    expect(label(downloading(84, 'receiving'))).toBe('Updating 42%');
    // Never claims 100% before verification.
    expect(label(downloading(200, 'receiving'))).toBe('Updating 99%');
    expect(label(downloading(200, 'verifying'))).toBe('Verifying…');
  });

  it('installs a verified manual download only while no machine work runs', () => {
    expect(view(manual('ready'))).toEqual({ kind: 'install', version: '1.0.31' });
    expect(view(manual('ready', { installOnQuit: true })).kind).toBe('install');
    const waiting = view(manual('ready'), { machineBusy: true });
    expect(waiting).toEqual({ kind: 'waiting', version: '1.0.31' });
    if (waiting.kind === 'hidden') throw new Error('shown');
    expect(toolbarUpdateLabel(waiting)).toBe('Update after job');
    expect(toolbarUpdateTitle(waiting)).toContain('never closes by itself');
    expect(toolbarUpdateGlows(waiting)).toBe(false);
  });

  it('sends a signed or install-less ready update to Check for Updates', () => {
    expect(view(signed('ready'))).toEqual({ kind: 'on-close', version: '1.0.31', onClose: true });
    // An older service without install-now: the panel chooses; nothing is armed yet.
    const unarmed = view(manual('ready'), {
      controls: { ...controls, installAndClose: undefined },
    });
    expect(unarmed).toEqual({ kind: 'on-close', version: '1.0.31', onClose: false });
    if (unarmed.kind === 'hidden') throw new Error('shown');
    expect(toolbarUpdateTitle(unarmed)).toContain('choose when it installs');
    // Machine work does not change a notice that installs only on a normal close.
    expect(view(signed('ready'), { machineBusy: true }).kind).toBe('on-close');
  });

  it('glows only where one click acts, and names the version for assistive tech', () => {
    expect(toolbarUpdateGlows(view(manual('available')))).toBe(true);
    expect(toolbarUpdateGlows(view(manual('ready')))).toBe(true);
    expect(toolbarUpdateGlows(view(manual('downloading')))).toBe(false);
    expect(toolbarUpdateGlows(view(manual('failed'), { engaged: true }))).toBe(false);
    const install = view(manual('ready'));
    if (install.kind === 'hidden') throw new Error('shown');
    expect(toolbarUpdateTitle(install)).toContain('KerfDesk 1.0.31');
    expect(toolbarUpdateTitle(install)).toContain('asks about unsaved changes');
  });
});
