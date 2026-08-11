import { expect } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { computeJobBounds, frameBoundsSignature } from '../../core/job';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  applyTransform,
  createLayer,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { prepareProjectForAutosave, prepareProjectForPersistence } from '../../io/project';
import { resetStore } from './test-helpers';
import { useStore } from './store';

export const RELIEF_ID = 'bounded-legacy-width-relief';
// eslint-disable-next-line no-restricted-syntax -- fixture scene data needs a stable layer color.
const RELIEF_COLOR = '#a0522d';
export const LOCAL_COORDINATE_LIMIT_MM = 1_000_000;
export const DISPLAYED_WIDTH_MM = 10;
export const INITIAL_SCALE = 5e-6;
export const FACTOR = 2;
export const INTENDED_WIDTH_MM = DISPLAYED_WIDTH_MM / INITIAL_SCALE;
export const INTENDED_HEIGHT_MM = INTENDED_WIDTH_MM / 2;
export const FACTORED_WIDTH_MM = INTENDED_WIDTH_MM / FACTOR;
export const FACTORED_HEIGHT_MM = INTENDED_HEIGHT_MM / FACTOR;
const MATERIALIZATION_CELL_MM = 1;
export const MESH_POSITIONS: ReadonlyArray<number> = Object.freeze([0, 0, 0, 2, 0, 1, 0, 1.5, 0]);

type LegacyGeometry = {
  readonly targetWidthMm: number;
  readonly boundsWidthMm: number;
  readonly boundsHeightMm: number;
  readonly scaleX: number;
  readonly scaleY: number;
};

export function legacyRelief(geometry: LegacyGeometry): MeshReliefObject {
  return {
    kind: 'relief',
    id: RELIEF_ID,
    source: 'legacy.stl',
    targetWidthMm: geometry.targetWidthMm,
    reliefDepthMm: 5,
    ...testLegacyMeshGeometry({
      positions: Array.from(MESH_POSITIONS),
      targetWidthMm: geometry.targetWidthMm,
    }),
    color: RELIEF_COLOR,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: geometry.boundsWidthMm,
      maxY: geometry.boundsHeightMm,
    },
    transform: {
      x: 50,
      y: 50,
      scaleX: geometry.scaleX,
      scaleY: geometry.scaleY,
      rotationDeg: 37,
      mirrorX: true,
      mirrorY: false,
    },
  };
}

export function infiniteBoundsAspectRelief(): MeshReliefObject {
  return legacyRelief({
    targetWidthMm: INTENDED_WIDTH_MM,
    boundsWidthMm: Number.MIN_VALUE * FACTOR,
    boundsHeightMm: 1,
    scaleX: 1,
    scaleY: 1,
  });
}

export function projectWithRelief(relief: MeshReliefObject): Project {
  const current = useStore.getState().project;
  return {
    ...current,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [relief],
      layers: [
        {
          ...createLayer({ id: RELIEF_COLOR, color: RELIEF_COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave', tabsEnabled: false },
        },
      ],
    },
  };
}

export function installRelief(relief: MeshReliefObject): void {
  resetStore();
  useStore.setState({
    project: projectWithRelief(relief),
    dirty: false,
    undoStack: [],
    redoStack: [],
  });
}

export function resizeLegacyMesh(meshPositions: ReadonlyArray<number> | Float32Array) {
  const initial = {
    ...legacyRelief({
      targetWidthMm: 2,
      boundsWidthMm: 2,
      boundsHeightMm: 1,
      scaleX: INITIAL_SCALE,
      scaleY: INITIAL_SCALE,
    }),
    ...testLegacyMeshGeometry({ positions: meshPositions, targetWidthMm: 2 }),
  } satisfies MeshReliefObject;
  installRelief(initial);
  useStore.getState().setReliefParams(RELIEF_ID, { targetWidthMm: INTENDED_WIDTH_MM });
  return { initial, updated: storedLegacyRelief() };
}

export function storedLegacyRelief(): MeshReliefObject {
  const object = useStore
    .getState()
    .project.scene.objects.find((candidate) => candidate.id === RELIEF_ID);
  if (object?.kind !== 'relief' || !isLegacyRelief(object)) {
    throw new Error('legacy-mesh relief missing');
  }
  return object;
}

function isLegacyRelief(relief: ReliefObject): relief is MeshReliefObject {
  return relief.reliefSource.kind === 'legacy-mesh';
}

export function materializedArtifact(relief: MeshReliefObject) {
  const result = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: Math.abs(relief.transform.scaleX),
    targetScaleY: Math.abs(relief.transform.scaleY),
    mmPerCell: MATERIALIZATION_CELL_MM,
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return {
    widthMm: result.widthMm,
    heightMm: result.heightMm,
    depthBytes: Array.from(
      new Uint8Array(
        result.heightmap.depth.buffer,
        result.heightmap.depth.byteOffset,
        result.heightmap.depth.byteLength,
      ),
    ),
  };
}

export function preparedArtifact(project: Project) {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.preflight));
  const bounds = computeJobBounds(prepared.job, prepared.project.device);
  if (bounds === null) throw new Error('prepared relief has no bounds');
  return {
    jobJson: JSON.stringify(prepared.job),
    frameSignature: frameBoundsSignature(bounds),
  };
}

export function transformedBoundsCorners(relief: MeshReliefObject) {
  const bounds = relief.bounds;
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => applyTransform(point, relief.transform));
}

export function boundsAspect(relief: MeshReliefObject): number {
  return (relief.bounds.maxY - relief.bounds.minY) / (relief.bounds.maxX - relief.bounds.minX);
}

export function meshAspect(relief: MeshReliefObject): number {
  const positions = relief.reliefSource.meshPositions;
  const xs = positions.filter((_value, index) => index % 3 === 0);
  const ys = positions.filter((_value, index) => index % 3 === 1);
  return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs));
}

export function meshBytes(relief: MeshReliefObject): ReadonlyArray<number> {
  const positions = relief.reliefSource.meshPositions;
  const floats = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  return Array.from(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
}

export function expectPersistence(expected: 'ok'): void {
  const project = useStore.getState().project;
  expect(prepareProjectForPersistence(project).kind).toBe(expected);
  expect(prepareProjectForAutosave(project).kind).toBe(expected);
}
