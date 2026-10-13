// File > Import G-code as artwork...: the cutting moves of a G-code file
// become one editable vector object placed where the program cuts on this
// bed. Only geometry comes across: no speeds, powers or passes. Opening the
// file in the G-code Inspector stays the way to check or run a program.

import { toSceneCoords } from '../../core/devices';
import { buildGcodeRenderModel } from '../../core/gcode-view/gcode-render-model';
import { gcodeCutPolylines } from '../../core/gcode-view/gcode-to-artwork';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Project } from '../../core/scene';
import { boundsOfPolylines } from '../../core/shapes/polyline-bounds';
import type { PlatformAdapter } from '../../platform/types';
import type { ImportOutcome } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { captureImportDocumentOwner } from './import-dispatch';

const GCODE_EXTENSIONS = ['.gcode', '.nc', '.gc', '.ngc', '.tap', '.txt'];

/** The artwork a program cuts, or a message saying why there is none. */
export function gcodeArtworkObject(
  name: string,
  text: string,
  project: Project,
):
  | { readonly ok: true; readonly object: ImportedSvg }
  | { readonly ok: false; readonly message: string } {
  const laser = project.machine?.kind !== 'cnc';
  const built = buildGcodeRenderModel(text, {
    machineKind: laser ? 'laser' : 'cnc',
    ...(laser ? { laserPowerControl: 'spindle' as const } : {}),
  });
  if (built.kind === 'error') return { ok: false, message: built.reason };
  const polylines = gcodeCutPolylines(built.model, (point) => toSceneCoords(point, project.device));
  if (polylines.length === 0)
    return { ok: false, message: 'The program has no cutting moves to import.' };
  return {
    ok: true,
    object: {
      kind: 'imported-svg',
      id: crypto.randomUUID(),
      source: name,
      bounds: boundsOfPolylines(polylines),
      transform: IDENTITY_TRANSFORM,
      // Scene data, not chrome: new artwork starts on the black operation colour.
      // eslint-disable-next-line no-restricted-syntax
      paths: [{ color: '#000000', polylines }],
    },
  };
}

export async function handleImportGcodeArtwork(args: {
  readonly platform: PlatformAdapter;
  readonly project: () => Project;
  readonly importObject: (object: ImportedSvg) => ImportOutcome;
  readonly getProjectDocumentEpoch: () => number;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
}): Promise<void> {
  const owner = captureImportDocumentOwner(args.getProjectDocumentEpoch);
  try {
    const files = await args.platform.pickFilesForOpen({
      accept: GCODE_EXTENSIONS,
      multiple: false,
    });
    const file = files[0];
    if (file === undefined || !owner.isCurrent()) return;
    const text = await file.text();
    if (!owner.isCurrent()) return;
    const result = gcodeArtworkObject(file.name, text, args.project());
    if (!result.ok) {
      args.pushToast(`${file.name}: ${result.message}`, 'warning');
      return;
    }
    args.importObject(result.object);
    const count = result.object.paths[0]?.polylines.length ?? 0;
    args.pushToast(
      `Imported ${count} path(s) from ${file.name} as artwork, where the program cuts on this bed. Speeds and powers are not imported.`,
      'success',
    );
  } catch (error) {
    args.pushToast(
      `Could not import G-code: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}
