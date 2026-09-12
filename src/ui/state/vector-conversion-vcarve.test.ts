import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectLayerPolylines } from '../../core/cnc/collect-cnc-contours';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type TextObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { textToPolylines } from '../../core/text';
import { compileJob } from '../../core/job';
import { deserializeProject, serializeProject } from '../../io/project';

const COLOR = '#111111';
const TOOL = {
  id: 'audit-v90',
  name: 'Audit V90',
  kind: 'v-bit' as const,
  diameterMm: 20,
  tipAngleDeg: 90,
};
const MACHINE = { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [TOOL], toolId: TOOL.id };
const LAYER: Layer = {
  ...createLayer({ id: 'audit-vcarve', color: COLOR }),
  cnc: {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'v-carve',
    vCarveFlatDepthEnabled: false,
    depthPerPassMm: 3,
    vResolutionMm: 0.25,
  },
};

function box(x: number, y: number, width: number, height: number): Polyline {
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

// Independent ray-crossing oracle over the compiler's input region, no production
// containment or simulator helper. All tested points are far from a boundary.
function parityContains(polylines: ReadonlyArray<Polyline>, point: Vec2): boolean {
  let inside = false;
  for (const polyline of polylines) {
    if (!polyline.closed) continue;
    const points = polyline.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i]!;
      const b = points[j]!;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  }
  return inside;
}

function scene(object: SceneObject): Scene {
  return { objects: [object], layers: [LAYER] };
}

function convertThroughUi(object: SceneObject): Scene {
  useStore.setState({
    project: { ...createProject(), machine: MACHINE, scene: scene(object) },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
  });
  useStore.getState().convertSelectionToPath();
  return useStore.getState().project.scene;
}

function contours(source: Scene) {
  return collectLayerPolylines(source.objects, LAYER, DEFAULT_DEVICE_PROFILE);
}

function lowestZ(source: Scene): number {
  const job = compileCncJob(source, DEFAULT_DEVICE_PROFILE, MACHINE);
  let z = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      if (pass.kind === 'path3d') for (const point of pass.points) z = Math.min(z, point.z);
      else if ('zMm' in pass) z = Math.min(z, pass.zMm);
    }
  }
  return z;
}

// Independent continuous swept-cone point probe for this test's 90-degree
// pointed tool. Along an XYZ segment the removal depth at P is
// max(0, -z(t) - distance(XY(t), P)). This function is concave, so a
// ternary search plus explicit endpoints finds its global maximum.
function removalAt(source: Scene, probe: Vec2): number {
  const job = compileCncJob(source, DEFAULT_DEVICE_PROFILE, MACHINE);
  let deepest = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      const points =
        pass.kind === 'path3d'
          ? pass.points
          : pass.kind === 'contour'
            ? pass.polyline.map((p) => ({ ...p, z: pass.zMm }))
            : [];
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1]!;
        const b = points[index]!;
        const depth = (t: number) =>
          -(a.z + (b.z - a.z) * t) -
          Math.hypot(a.x + (b.x - a.x) * t - probe.x, a.y + (b.y - a.y) * t - probe.y);
        let low = 0;
        let high = 1;
        for (let i = 0; i < 64; i++) {
          const left = (low * 2 + high) / 3;
          const right = (low + high * 2) / 3;
          if (depth(left) < depth(right)) low = left;
          else high = right;
        }
        deepest = Math.max(deepest, depth(0), depth(1), depth((low + high) / 2));
      }
    }
  }
  return deepest;
}

afterEach(resetStore);

describe('Convert to Path preserves cutting regions and centrelines', () => {
  it('keeps overlapping text joins connected without changing laser or engraving centrelines', () => {
    const object: TextObject = {
      kind: 'text',
      id: 'audit-script',
      content: 'ab',
      fontKey: 'audit-script',
      sizeMm: 4,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: COLOR,
      bounds: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: COLOR, polylines: [box(0, 0, 4, 4), box(2, 0, 4, 4)] }],
    };
    const before = scene(object);
    const after = convertThroughUi(object);
    const join = toMachineCoords({ x: 3, y: 2 }, DEFAULT_DEVICE_PROFILE);
    expect(parityContains(contours(before), join)).toBe(true);
    expect(after.objects[0]?.kind).toBe('imported-svg');
    expect(parityContains(contours(after), join)).toBe(true);
    const beforeZ = lowestZ(before);
    const afterZ = lowestZ(after);
    expect(beforeZ).toBeLessThan(-1.8);
    expect(afterZ).toBeCloseTo(beforeZ, 3);
    expectOtherOperationGeometry(before, after);
    useStore.getState().weldSelection();
    expect(parityContains(contours(useStore.getState().project.scene), join)).toBe(true);
  }, 20_000);

  it('preserves the protected centre of a stretched trusted stroke through conversion and reload', () => {
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'audit-stroke',
      source: 'Library: square outline',
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 1 },
      paths: [{ color: COLOR, strokeWidthMm: 0.5, polylines: [box(0, 0, 4, 4)] }],
    };
    const before = scene(object);
    const after = convertThroughUi(object);
    const centre = toMachineCoords({ x: 4, y: 2 }, DEFAULT_DEVICE_PROFILE);
    expect(parityContains(contours(before), centre)).toBe(false);
    expect(parityContains(contours(after), centre)).toBe(false);
    const afterObject = after.objects[0];
    expect(afterObject && 'paths' in afterObject ? afterObject.paths[0]?.strokeWidthMm : -1).toBe(
      0.5,
    );
    const beforeZ = lowestZ(before);
    const afterZ = lowestZ(after);
    const beforeCentreRemovalMm = removalAt(before, centre);
    const afterCentreRemovalMm = removalAt(after, centre);
    expect(beforeZ).toBeGreaterThan(-0.6);
    expect(afterZ).toBeCloseTo(beforeZ, 3);
    expect(beforeCentreRemovalMm).toBe(0);
    expect(afterCentreRemovalMm).toBe(0);
    expectOtherOperationGeometry(before, after);
    const loaded = deserializeProject(serializeProject(useStore.getState().project));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect(removalAt(loaded.project.scene, centre)).toBe(0);
    expect(contours(loaded.project.scene)).toEqual(contours(after));
    useStore.getState().weldSelection();
    expect(removalAt(useStore.getState().project.scene, centre)).toBe(0);
  }, 20_000);

  it('keeps every sampled fill point of bundled Dancing Script Drive after conversion, repeat conversion and reload', async () => {
    const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts/DancingScript-Regular.ttf'));
    const fontBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const rendered = await textToPolylines({
      fontBuffer,
      content: 'Drive',
      sizeMm: 20,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: COLOR,
    });
    const object: TextObject = {
      kind: 'text',
      id: 'audit-real-drive',
      content: 'Drive',
      fontKey: 'dancing-script-regular',
      sizeMm: 20,
      alignment: 'left',
      lineHeight: 1,
      letterSpacing: 0,
      color: COLOR,
      bounds: rendered.bounds,
      transform: IDENTITY_TRANSFORM,
      paths: rendered.paths,
    };
    const before = contours(scene(object));
    convertThroughUi(object);
    useStore.getState().convertSelectionToPath();
    const loaded = deserializeProject(serializeProject(useStore.getState().project));
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    const after = contours(loaded.project.scene);
    let changedCount = 0;
    for (let y = rendered.bounds.minY + 0.025; y < rendered.bounds.maxY; y += 0.05) {
      for (let x = rendered.bounds.minX + 0.025; x < rendered.bounds.maxX; x += 0.05) {
        const machinePoint = toMachineCoords({ x, y }, DEFAULT_DEVICE_PROFILE);
        if (parityContains(before, machinePoint) !== parityContains(after, machinePoint))
          changedCount++;
      }
    }
    expect(before).toHaveLength(4);
    expect(after).toHaveLength(4);
    expect(changedCount).toBe(0);
  }, 20_000);
});

function expectOtherOperationGeometry(before: Scene, after: Scene): void {
  for (const cutType of ['engrave', 'profile-on-path'] as const) {
    const layer = { ...LAYER, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } };
    const compile = (source: Scene) =>
      compileCncJob({ ...source, layers: [layer] }, DEFAULT_DEVICE_PROFILE, MACHINE).groups;
    expect(compile(after)).toEqual(compile(before));
  }
  const laser = (source: Scene) => compileJob(source, DEFAULT_DEVICE_PROFILE).groups;
  expect(laser(after)).toEqual(laser(before));
  const fillLayer = { ...LAYER, mode: 'fill' as const };
  expect(laser({ ...after, layers: [fillLayer] })).toEqual(
    laser({ ...before, layers: [fillLayer] }),
  );
}
