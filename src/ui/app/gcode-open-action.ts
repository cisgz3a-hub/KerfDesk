// G-code open actions (F-M1 + F-CNC10). handleOpenGcodeInspector picks a
// .nc/.gcode/.tap file and hands its TEXT to the 3D Inspector (both machine
// modes — ADR-255 lifted the ADR-101 CNC-only gate). The F-CNC10 2D
// simulator flow remains via open2dSimulatorFromText, byte-identical toasts.

import type { Toolpath } from '../../core/job';
import { parseGcodeProgram } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';
import { importSourceSizeAdvisory } from './import-size-advisory';

type PushToast = (message: string, variant?: ToastVariant) => void;
type GcodeSourceFile = {
  readonly name: string;
  readonly size?: number;
  readonly text: () => Promise<string>;
};

const GCODE_ACCEPT = ['.nc', '.gcode', '.tap'];

export function isGcodeFile(file: Pick<GcodeSourceFile, 'name'>): boolean {
  const name = file.name.toLowerCase();
  return GCODE_ACCEPT.some((extension) => name.endsWith(extension));
}

async function pickGcodeFile(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<GcodeSourceFile | null> {
  let files: ReadonlyArray<GcodeSourceFile>;
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
  return file ?? null;
}

async function readGcodeFile(file: GcodeSourceFile, pushToast: PushToast): Promise<string | null> {
  const sizeAdvisory = importSourceSizeAdvisory(file, 'gcode');
  if (sizeAdvisory !== null) pushToast(sizeAdvisory, 'warning');
  try {
    return await file.text();
  } catch (err) {
    pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return null;
  }
}

export async function openGcodeFileInInspector(
  file: GcodeSourceFile,
  openInspector: (name: string, text: string) => void,
  pushToast: PushToast,
): Promise<void> {
  const text = await readGcodeFile(file, pushToast);
  if (text !== null) openInspector(file.name, text);
}

export async function handleOpenGcodeInspector(
  platform: PlatformAdapter,
  openInspector: (name: string, text: string) => void,
  pushToast: PushToast,
): Promise<void> {
  const file = await pickGcodeFile(platform, pushToast);
  if (file === null) return;
  await openGcodeFileInInspector(file, openInspector, pushToast);
}

export async function handleOpenGcodePreview(
  platform: PlatformAdapter,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: PushToast,
): Promise<void> {
  const file = await pickGcodeFile(platform, pushToast);
  if (file === null) return;
  const text = await readGcodeFile(file, pushToast);
  if (text !== null) open2dSimulatorFromText(file.name, text, openPreview, pushToast);
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
