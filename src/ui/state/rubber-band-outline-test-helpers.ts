// Fixtures and an independent G-code reader for the Rubber-Band Outline
// regressions (tools audit T1, T34; ADR-480 Amendment 7). The reader looks at
// G-code words only, so it shares nothing with the planner: a laser burn is
// the lit length per F/S pair, and a CNC cut is the XY length below Z 0 with
// its deepest Z.

import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { useStore } from './store';

export function square(x: number, y: number, width: number, height = width): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

export function vector(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  operation: string,
): ImportedSvg {
  const points = polylines.flatMap((polyline) => polyline.points);
  return {
    kind: 'imported-svg',
    id,
    source: `test ${id}`,
    operationIds: [operation],
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxX: Math.max(...points.map((point) => point.x)),
      maxY: Math.max(...points.map((point) => point.y)),
    },
    // eslint-disable-next-line no-restricted-syntax -- scene data, not UI chrome: artwork colour
    paths: [{ color: '#000000', operationIds: [operation], polylines }],
  };
}

export function lineOperation(
  id: string,
  power: number,
  speed: number,
  extra: Partial<Layer> = {},
): Layer {
  return {
    // eslint-disable-next-line no-restricted-syntax -- scene data, not UI chrome: operation colour
    ...createLayer({ id, color: '#123456', name: id, mode: 'line' }),
    power,
    speed,
    ...extra,
  };
}

export function withScene(
  base: Project,
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
): Project {
  return {
    ...base,
    scene: {
      ...base.scene,
      objects,
      layers,
      groups: [],
      artworkOrder: objects.map((object) => object.id),
    },
  };
}

export function laserProject(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer>,
): Project {
  const base = createProject();
  return withScene({ ...base, optimization: { ...DEFAULT_PROJECT_OPTIMIZATION } }, objects, layers);
}

/** Load a project with `ids` selected in that order (the first is the primary). */
export function selectInOrder(project: Project, ids: ReadonlyArray<string>): void {
  useStore.setState({
    project,
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

/** The object the tool added, and its operation. */
export function addedOutline(before: Project): {
  readonly object: SceneObject;
  readonly operation: Layer;
} {
  const known = new Set(before.scene.objects.map((object) => object.id));
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((entry) => !known.has(entry.id));
  if (object === undefined) throw new Error('no outline was added');
  const operation = scene.layers.find((layer) => object.operationIds?.includes(layer.id));
  if (operation === undefined) throw new Error('the outline has no operation');
  return { object, operation };
}

/** The project with only one object left, to burn it alone. */
export function onlyObject(project: Project, id: string): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.filter((object) => object.id === id),
      artworkOrder: [id],
    },
  };
}

export function gcodeOf(project: Project): string {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('output failed');
  return emitPreparedGcode(prepared).gcode;
}

function wordsOf(raw: string): ReadonlyMap<string, number> {
  const line = raw
    .replace(/;.*$/, '')
    .replace(/\(.*?\)/g, '')
    .toUpperCase();
  const words = new Map<string, number>();
  for (const [, letter, value] of line.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) {
    if (letter === undefined) continue;
    // G and M words can repeat on one line; keep each as its own key.
    if (letter === 'G' || letter === 'M') words.set(`${letter}${Number(value)}`, 1);
    else words.set(letter, Number(value));
  }
  return words;
}

type Laser = { x: number; y: number; feed: number; power: number; mode: number; on: boolean };

function motionMode(words: ReadonlyMap<string, number>, current: number): number {
  return [0, 1, 2, 3].find((g) => words.has(`G${g}`)) ?? current;
}

function updateLaser(laser: Laser, words: ReadonlyMap<string, number>): void {
  if (words.has('M3') || words.has('M4')) laser.on = true;
  if (words.has('M5')) laser.on = false;
  laser.mode = motionMode(words, laser.mode);
  laser.feed = words.get('F') ?? laser.feed;
  laser.power = words.get('S') ?? laser.power;
}

/** Lit length (mm) per `F…/S…` pair; G1 only, since the outline and fixtures are straight. */
export function litLengthByFeedAndPower(gcode: string): ReadonlyMap<string, number> {
  const laser: Laser = { x: 0, y: 0, feed: 0, power: 0, mode: 0, on: false };
  const runs = new Map<string, number>();
  for (const raw of gcode.split('\n')) {
    const words = wordsOf(raw);
    updateLaser(laser, words);
    const x = words.get('X') ?? laser.x;
    const y = words.get('Y') ?? laser.y;
    const moves = words.has('X') || words.has('Y');
    if (moves && laser.mode === 1 && laser.on && laser.power > 0) {
      const key = `F${laser.feed}/S${laser.power}`;
      runs.set(key, (runs.get(key) ?? 0) + Math.hypot(x - laser.x, y - laser.y));
    }
    laser.x = x;
    laser.y = y;
  }
  return runs;
}

export function totalLength(runs: ReadonlyMap<string, number>): number {
  return [...runs.values()].reduce((sum, length) => sum + length, 0);
}

/** CNC: XY length cut below Z 0 (G1, and G2/G3 by chord) and the deepest Z reached. */
export function cncCut(gcode: string): { readonly cutMm: number; readonly minZ: number } {
  let x = 0;
  let y = 0;
  let z = 10;
  let mode = 0;
  let cutMm = 0;
  let minZ = 0;
  for (const raw of gcode.split('\n')) {
    const words = wordsOf(raw);
    mode = motionMode(words, mode);
    const nx = words.get('X') ?? x;
    const ny = words.get('Y') ?? y;
    const nz = words.get('Z') ?? z;
    if (mode >= 1 && nz < 0) minZ = Math.min(minZ, nz);
    if (mode >= 1 && nz < 0 && z < 0) cutMm += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    z = nz;
  }
  return { cutMm, minZ };
}
