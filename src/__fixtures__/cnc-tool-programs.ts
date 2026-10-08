import type { CncGroup } from '../core/job';
import type { PreparedOutput } from '../io/gcode';
import { projectWithLine } from './file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../core/scene';
import { benchmarkLayer, benchmarkRectangle, benchmarkVector } from './cnc-leader-fixtures';

export function preparedCncToolSections(): Extract<PreparedOutput, { readonly ok: true }> {
  const base = projectWithLine();
  const project = {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'A',
      tools: [
        { id: 'A', name: 'Rough cutter A', kind: 'end-mill' as const, diameterMm: 6 },
        { id: 'B', name: 'Detail cutter B', kind: 'end-mill' as const, diameterMm: 2 },
      ],
    },
  };
  return {
    ok: true,
    project,
    jobOriginOffset: { x: 30, y: 40 },
    job: {
      groups: [
        toolSectionGroup('rough-1', 'A', 101, 50),
        { ...toolSectionGroup('rough-2', 'A', 202, 60), spindleRpm: 9000 },
        toolSectionGroup('detail', 'B', 303, 70),
        { ...toolSectionGroup('release', 'A', 404, 80), cutType: 'profile-outside' },
      ],
    },
  };
}

function toolSectionGroup(layerId: string, toolId: string, feed: number, x: number): CncGroup {
  return {
    kind: 'cnc',
    layerId,
    toolId,
    toolName: toolId === 'A' ? 'Rough cutter A' : 'Detail cutter B',
    toolDiameterMm: toolId === 'A' ? 6 : 2,
    color: '#000000',
    cutType: 'pocket',
    toolKind: 'end-mill',
    cuttingStage: 'pocket-rough',
    feedMmPerMin: feed,
    plungeMmPerMin: 37,
    spindleRpm: 12000,
    spindleSpinupSec: 0.25,
    safeZMm: 5,
    parkZMm: 8,
    parkXMm: 13,
    parkYMm: 17,
    coolant: 'flood',
    passes: [
      {
        kind: 'contour',
        closed: false,
        zMm: -1,
        polyline: [
          { x, y: 30 },
          { x: x + 10, y: 30 },
        ],
      },
    ],
  };
}

/** A real compiler fixture: rough A, detail B, then release A. */
export function cncToolSectionProject() {
  const base = preparedCncToolSections().project;
  const pocket = benchmarkLayer('detail-pocket', {
    cutType: 'pocket',
    toolId: 'B',
    pocketRoughToolId: 'A',
    depthMm: 1,
    depthPerPassMm: 1,
  });
  const release = benchmarkLayer('release-profile', {
    cutType: 'profile-outside',
    toolId: 'A',
    depthMm: 1,
    depthPerPassMm: 1,
  });
  return {
    ...base,
    device: { ...base.device, origin: 'rear-left' as const },
    scene: {
      layers: [pocket, release],
      objects: [
        benchmarkVector('pocket-vector', [benchmarkRectangle(20, 20, 25, 25)], [pocket.id]),
        benchmarkVector('release-vector', [benchmarkRectangle(10, 10, 50, 50)], [release.id]),
      ],
    },
  };
}
