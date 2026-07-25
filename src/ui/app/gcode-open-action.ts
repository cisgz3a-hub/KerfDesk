// G-code open actions (F-M1 + F-CNC10). handleOpenGcodeInspector picks a
// .nc/.gcode/.tap file and hands its TEXT to the 3D Inspector (both machine
// modes — ADR-255 lifted the ADR-101 CNC-only gate). The F-CNC10 2D
// simulator flow remains via open2dSimulatorFromText, byte-identical toasts.

import type { Toolpath } from '../../core/job';
import { parseGcodeProgram } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';
import { importSourceSizeIssue } from './import-source-limits';

type PushToast = (message: string, variant?: ToastVariant) => void;
type PickedFile = { readonly name: string; readonly text: () => Promise<string> };

const GCODE_ACCEPT = ['.nc', '.gcode', '.tap'];

async function pickGcodeFile(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<PickedFile | null> {
  let files: ReadonlyArray<PickedFile>;
  try {
    files = await platform.pickFilesForOpen({ accept: GCODE_ACCEPT, multiple: false });
  } catch (err) {
    pushToast(
      `Could not open G-code: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
    return null;
  }
  const file = files[0];
  if (file === undefined) return null;
  const sizeIssue = importSourceSizeIssue(file, 'gcode');
  if (sizeIssue !== null) {
    pushToast(sizeIssue, 'error');
    return null;
  }
  return file;
}

export async function handleOpenGcodeInspector(
  platform: PlatformAdapter,
  openInspector: (name: string, text: string) => void,
  pushToast: PushToast,
): Promise<void> {
  const file = await pickGcodeFile(platform, pushToast);
  if (file === null) return;
  try {
    openInspector(file.name, await file.text());
  } catch (err) {
    pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

export async function handleOpenGcodePreview(
  platform: PlatformAdapter,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: PushToast,
): Promise<void> {
  const file = await pickGcodeFile(platform, pushToast);
  if (file === null) return;
  try {
    open2dSimulatorFromText(file.name, await file.text(), openPreview, pushToast);
  } catch (err) {
    pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

// The F-CNC10 2D-simulator body, callable from the Inspector's handoff button
// with already-read text. Messages unchanged from the pre-ADR-255 flow.
export function open2dSimulatorFromText(
  name: string,
  text: string,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: PushToast,
): void {
  const result = parseGcodeProgram(text);
  if (result.kind === 'error') {
    pushToast(`${name}: ${result.reason}`, 'error');
    return;
  }
  if (result.toolpath.steps.length === 0) {
    pushToast(`${name}: no motion found — nothing to simulate.`, 'warning');
    return;
  }
  openPreview(name, result.toolpath);
  const skipped = result.notes.length > 0 ? ` (${result.notes.join(', ')})` : '';
  pushToast(
    `Simulating ${name}: ${result.summary.cutMm.toFixed(0)} mm cut, ` +
      `${result.summary.travelMm.toFixed(0)} mm travel${skipped}. Exit Preview to return.`,
    'success',
  );
}
