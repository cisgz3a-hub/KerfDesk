import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildToolpath } from '../../core/job/toolpath';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';

export const device = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'rear-left' as const,
  bedWidth: 400,
  bedHeight: 400,
};

export function square(min: number, max: number): Polyline {
  return {
    closed: true,
    points: [
      { x: min, y: min },
      { x: max, y: min },
      { x: max, y: max },
      { x: min, y: max },
    ],
  };
}

export function compiled(
  settings: Partial<CncLayerSettings>,
  polylines: Polyline[] = [square(50, 70)],
  diameterMm = 4,
) {
  const layer = {
    ...createLayer({ id: 'repair-output-op', color: '#123456' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      tabsEnabled: false,
      profileLead: { shape: 'none' as const },
      lineArtContours: 'both' as const,
      ...settings,
    },
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'repair-output-object',
    source: 'analytic.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [layer.id],
    paths: [{ color: layer.color, polylines }],
  };
  const project = {
    ...createProject(),
    device,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: 'repair-flat',
      tools: [
        { id: 'repair-flat', name: 'Analytic end mill', kind: 'end-mill' as const, diameterMm },
      ],
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 5, spindleSpinupSec: 0 },
    },
    scene: { objects: [object], layers: [layer] },
  };
  const job = compileCncJob(project.scene, project.device, project.machine);
  const output = emitGcode(project);
  return { project, job, output, moves: motions(output.gcode), preview: buildToolpath(job) };
}

type Position = { x: number; y: number; z: number };
export type Motion = {
  line: string;
  mode: number;
  from: Position;
  to: Position;
  feed: number;
};

// Independent of the application parser. These native fixtures emit absolute
// millimetre G0/G1 blocks; arc interpretation belongs to its separate repair.
export function motions(gcode: string): Motion[] {
  let point: Position = { x: 0, y: 0, z: 0 };
  let feed = 0;
  let mode = 0;
  const result: Motion[] = [];
  for (const original of gcode.split('\n')) {
    const line = original.replace(/;.*/, '').replace(/\([^)]*\)/g, '');
    const words = [...line.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(
      (match) => [match[1], Number(match[2])] as const,
    );
    for (const [letter, value] of words) {
      if (letter === 'G' && [0, 1, 2, 3].includes(value)) mode = value;
      if (letter === 'F') feed = value;
    }
    if (!words.some(([letter]) => ['X', 'Y', 'Z'].includes(letter ?? ''))) continue;
    const value = (letter: string, fallback: number) =>
      words.find(([candidate]) => candidate === letter)?.[1] ?? fallback;
    const next = { x: value('X', point.x), y: value('Y', point.y), z: value('Z', point.z) };
    result.push({ line: original, mode, from: point, to: next, feed });
    point = next;
  }
  return result;
}

export function xyLength(move: Motion): number {
  return Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y);
}
