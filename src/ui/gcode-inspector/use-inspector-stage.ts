// What the 3D view dresses the job with (ADR-426): the look, the box the cuts
// fill, the bed when the program runs in bed coordinates, and the tool cutting
// at the playhead. Studio draws a bit only from geometry the program states,
// and a laser head only for a laser program; anything else keeps the Classic
// marker rather than guess.

import { useMemo } from 'react';
import type { AxisBounds, GcodeRenderModel } from '../../core/gcode-view';
import { toolProfile } from '../../core/sim';
import { bitPreviewGeometryIssue } from '../cnc-viewer3d/bit-preview-profile';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type {
  StudioToolSpec,
  Viewer3dLook,
  Viewer3dRect,
  Viewer3dStage,
} from '../viewer3d/viewer3d-look';
import type { ProgramToolGeometry } from './program-tools';
import { toolAtSegment, type ProgramTool, type ToolSections } from './tool-sections';

const NO_TOOL: StudioToolSpec = { kind: 'none' };
const LASER: StudioToolSpec = { kind: 'laser' };

export function useInspectorStage(args: {
  readonly model: GcodeRenderModel;
  readonly sections: ToolSections;
  readonly look: Viewer3dLook;
  readonly machineKind: 'laser' | 'cnc' | undefined;
  readonly workArea: Viewer3dRect | undefined;
  readonly playheadSegment: number;
}): Viewer3dStage {
  const { model, sections, look, machineKind, workArea } = args;
  const jobBox = useMemo(() => jobBoxOf(model.stats.cutBounds), [model]);
  // Only a tool change moves the stage; every other playhead step keeps it.
  const tool = toolAtSegment(sections, args.playheadSegment);
  const toolSpec = useMemo(() => studioToolSpec(tool, machineKind), [tool, machineKind]);
  return useMemo(
    () => ({ look, jobBox, workArea: workArea ?? null, tool: toolSpec }),
    [look, jobBox, workArea, toolSpec],
  );
}

// A cut that goes below Z0 started from the stock top, so the box's top sits
// at Z0 rather than at the height the bit plunged from.
function jobBoxOf(cutBounds: AxisBounds | null): AxisBounds | null {
  if (cutBounds === null) return null;
  return cutBounds.minZ < 0 ? { ...cutBounds, maxZ: Math.min(cutBounds.maxZ, 0) } : cutBounds;
}

export function studioToolSpec(
  tool: ProgramTool | null,
  machineKind: 'laser' | 'cnc' | undefined,
): StudioToolSpec {
  if (machineKind === 'laser') return LASER;
  // A program only states bit geometry in KerfDesk's CNC comments, so an
  // opened file with them is a CNC program even without a machine kind.
  const geometry = tool?.geometry ?? null;
  return geometry === null ? NO_TOOL : bitSpec(geometry, tool?.label ?? '');
}

function bitSpec(geometry: ProgramToolGeometry, name: string): StudioToolSpec {
  const tool = {
    id: name,
    name,
    kind: geometry.kind,
    diameterMm: geometry.diameterMm,
    ...(geometry.tipAngleDeg === undefined ? {} : { tipAngleDeg: geometry.tipAngleDeg }),
    ...(geometry.tipDiameterMm === undefined ? {} : { tipDiameterMm: geometry.tipDiameterMm }),
  };
  if (bitPreviewGeometryIssue(tool) !== null) return NO_TOOL;
  // The program does not state the shank; the model's shank follows the cutter.
  return { kind: 'bit', profile: toolProfile(tool), shankDiameterMm: 0 };
}
