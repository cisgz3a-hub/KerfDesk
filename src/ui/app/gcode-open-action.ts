// G-code open actions (F-M1 + F-CNC10). handleOpenGcodeInspector picks a
// .nc/.gcode/.tap file and hands its Blob to the 3D Inspector when the
// platform exposes one (both machine modes — ADR-255 lifted the ADR-101
// CNC-only gate). The F-CNC10 2D simulator flow remains.

import type { Toolpath } from '../../core/job';
import { parseGcodeProgram } from '../../io/gcode';
import type { PlatformAdapter } from '../../platform/types';
import type { GcodeInspectionSource } from '../gcode-inspector';
import {
  parseGcodeOffThread,
  type ImportWorkerRequestOptions,
} from '../import/import-worker-client';
import { resolveImportBlob, type BlobSourceFile } from '../import/import-file-blob';
import type { ToastVariant } from '../state/toast-store';
import { importSourceSizeAdvisory } from './import-size-advisory';
import { annotateGcode2dPreviewPressure } from './gcode-2d-preview-pressure';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';

type PushToast = (message: string, variant?: ToastVariant) => void;
type GcodeSourceFile = BlobSourceFile;

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

async function readGcodeSource(
  file: GcodeSourceFile,
  pushToast: PushToast,
): Promise<GcodeInspectionSource | null> {
  const sizeAdvisory = importSourceSizeAdvisory(file, 'gcode');
  if (sizeAdvisory !== null) pushToast(sizeAdvisory, 'warning');
  const blob = await resolveImportBlob(file);
  if (blob !== null) return { kind: 'blob', blob };
  try {
    return { kind: 'text', text: await file.text() };
  } catch (err) {
    pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return null;
  }
}

export async function openGcodeFileInInspector(
  file: GcodeSourceFile,
  openInspector: (name: string, source: GcodeInspectionSource) => void,
  pushToast: PushToast,
): Promise<void> {
  const source = await readGcodeSource(file, pushToast);
  if (source !== null) openInspector(file.name, source);
}

export async function handleOpenGcodeInspector(
  platform: PlatformAdapter,
  openInspector: (name: string, source: GcodeInspectionSource) => void,
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
  const source = await readGcodeSource(file, pushToast);
  if (source === null) return;
  const controls = createImportWorkerControls(file.name, pushToast);
  try {
    await open2dSimulatorFromSource(file.name, source, openPreview, pushToast, controls.options);
  } finally {
    controls.dispose();
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
  open2dSimulatorFromResult(name, parseGcodeProgram(text), openPreview, pushToast);
}

export async function open2dSimulatorFromSource(
  name: string,
  source: GcodeInspectionSource,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: PushToast,
  options: ImportWorkerRequestOptions = {},
): Promise<void> {
  try {
    const offThread =
      source.kind === 'blob'
        ? parseGcodeOffThread(source.blob, options)
        : parseGcodeOffThread(new Blob([source.text]), options);
    const result =
      offThread ??
      (source.kind === 'text'
        ? parseGcodeProgram(source.text)
        : Promise.reject(new Error('G-code import worker unavailable')));
    open2dSimulatorFromResult(name, await result, openPreview, pushToast);
  } catch (error) {
    pushToast(
      isImportCancellation(error)
        ? `${name}: 2D preview cancelled.`
        : `${name}: ${error instanceof Error ? error.message : String(error)}`,
      isImportCancellation(error) ? 'warning' : 'error',
    );
  }
}

function open2dSimulatorFromResult(
  name: string,
  result: ReturnType<typeof parseGcodeProgram>,
  openPreview: (name: string, toolpath: Toolpath) => void,
  pushToast: PushToast,
): void {
  if (result.kind === 'error') {
    pushToast(`${name}: ${result.reason}`, 'error');
    return;
  }
  if (result.toolpath.steps.length === 0) {
    pushToast(`${name}: no motion found — nothing to simulate.`, 'warning');
    return;
  }
  openPreview(name, annotateGcode2dPreviewPressure(result.toolpath));
  const skipped = result.notes.length > 0 ? ` (${result.notes.join(', ')})` : '';
  pushToast(
    `Simulating ${name}: ${result.summary.cutMm.toFixed(0)} mm cut, ` +
      `${result.summary.travelMm.toFixed(0)} mm travel${skipped}. Exit Preview to return.`,
    'success',
  );
}
