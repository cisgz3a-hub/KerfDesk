// handleOpenGcodePreview — pick a .nc/.gcode/.tap file, parse it with the
// clean-room modal parser, and hand the toolpath to the simulator slot
// (Phase H.6b, F-CNC10). CNC-only at the command layer (ADR-101).

import type { Toolpath } from '../../core/job';
import { parseGcodeProgram } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';

export async function handleOpenGcodePreview(
  platform: PlatformAdapter,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  let files: ReadonlyArray<{ readonly name: string; readonly text: () => Promise<string> }>;
  try {
    files = await platform.pickFilesForOpen({
      accept: ['.nc', '.gcode', '.tap'],
      multiple: false,
    });
  } catch (err) {
    pushToast(
      `Could not open G-code: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
    return;
  }
  const file = files[0];
  if (file === undefined) return;
  try {
    const result = parseGcodeProgram(await file.text());
    if (result.kind === 'error') {
      pushToast(`${file.name}: ${result.reason}`, 'error');
      return;
    }
    if (result.toolpath.steps.length === 0) {
      pushToast(`${file.name}: no motion found — nothing to simulate.`, 'warning');
      return;
    }
    openPreview(file.name, result.toolpath);
    const skipped = result.notes.length > 0 ? ` (${result.notes.join(', ')})` : '';
    pushToast(
      `Simulating ${file.name}: ${result.summary.cutMm.toFixed(0)} mm cut, ` +
        `${result.summary.travelMm.toFixed(0)} mm travel${skipped}. Exit Preview to return.`,
      'success',
    );
  } catch (err) {
    pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}
