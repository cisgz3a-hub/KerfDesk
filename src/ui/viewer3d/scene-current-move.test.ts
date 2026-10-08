import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDepthBatches } from './line-depth-batches';
import { addTrail, setTrail } from './line-trail';
import { createProgramGeometry, shareProgramGeometry } from './program-lines';
import { createCurrentMove, type CurrentMove } from './scene-current-move';
import { disposeChildren } from './scene-furniture';
import { resolveViewer3dTheme } from './viewer3d-theme';

const groups: three.Group[] = [];
afterEach(() => {
  for (const group of groups) disposeChildren(group);
  groups.length = 0;
});

function current(planar = false, Material: typeof LineMaterial = LineMaterial) {
  const active = createCurrentMove(
    {
      three,
      LineSegments2,
      LineSegmentsGeometry,
      LineMaterial: Material,
      theme: resolveViewer3dTheme(),
      viewWidth: 800,
      viewHeight: 600,
    },
    planar,
  );
  groups.push(active.object);
  return active;
}

function visible(active: CurrentMove) {
  return active.object.children.map((child) => child.visible);
}

function compiled(material: LineMaterial) {
  const shader = {
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

function completed() {
  const colors = new Uint16Array([10000, 20000, 30000, 65535, 10000, 20000, 30000, 65535]);
  const { geometry } = createProgramGeometry(
    three,
    LineSegmentsGeometry,
    new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 20, 0, 1]),
    colors,
  );
  const material = new LineMaterial();
  const trail = addTrail(three, material);
  const lines = new LineSegments2(geometry, material);
  const ghost = new LineSegments2(
    shareProgramGeometry(LineSegmentsGeometry, geometry),
    new LineMaterial(),
  );
  const batches = createDepthBatches({ three, LineSegments2, lines, ghost, trail, colors });
  const group = new three.Group();
  group.add(...batches.objects);
  groups.push(group);
  return { batches, colors, trail };
}

describe('active move exact and hardware ramp pairs', () => {
  it('keeps exact depth by default, with every hidden pair attached to the same geometry', () => {
    const active = current();
    const strokes = active.object.children as LineSegments2[];
    expect(strokes).toHaveLength(4);
    expect(active.materials).toHaveLength(4);
    expect(visible(active)).toEqual([true, true, false, false]);
    expect(strokes.map((stroke) => stroke.renderOrder)).toEqual([3, 4, 3, 4]);
    expect(active.materials.map((material) => material.linewidth)).toEqual([8, 4, 8, 4]);
    expect(active.materials.map((material) => material.depthWrite)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(new Set(strokes.map((stroke) => stroke.geometry)).size).toBe(1);
    expect(new Set(strokes.map((stroke) => stroke.name)).size).toBe(4);
    for (const stroke of strokes) expect(stroke.frustumCulled).toBe(false);
    for (const index of [0, 1])
      expect(compiled(active.materials[index]!).fragmentShader).toContain('gl_FragDepth');
    for (const index of [2, 3])
      expect(compiled(active.materials[index]!).fragmentShader).not.toContain('gl_FragDepth');
  });

  it('changes pair immediately on permission changes and on ramp/flat placement', () => {
    const active = current();
    active.object.visible = true;
    active.place([0, 0, 0], [10, 0, 1]);
    expect(visible(active)).toEqual([true, true, false, false]);
    active.useHardwareDepth(true);
    expect(visible(active)).toEqual([false, false, true, true]);
    active.place([10, 0, 1], [20, 0, 1]);
    expect(visible(active)).toEqual([true, true, false, false]);
    active.place([20, 0, 1], [30, 0, -1]);
    expect(visible(active)).toEqual([false, false, true, true]);
    active.useHardwareDepth(false);
    expect(visible(active)).toEqual([true, true, false, false]);
    active.useHardwareDepth(true);
    expect(visible(active)).toEqual([false, false, true, true]);
    expect(active.object.visible).toBe(true);
  });

  it('classifies the stored Float32 endpoints, including a tiny unequal stored depth', () => {
    const active = current();
    const buffer = active.positions();
    active.useHardwareDepth(true);
    active.place([0, 0, 1], [10, 0, 1 + 2e-8]);
    expect(active.positions()[2]).toBe(active.positions()[5]);
    expect(visible(active)).toEqual([true, true, false, false]);
    active.place([0, 0, 1], [10, 0, 1 + 2 ** -22]);
    expect(active.positions()[2]).not.toBe(active.positions()[5]);
    expect(visible(active)).toEqual([false, false, true, true]);
    expect(active.positions()).toBe(buffer);
    expect(active.positions()).toHaveLength(6);
  });

  it('keeps planar moves on the original two materials and makes the permission method a no-op', () => {
    const active = current(true);
    active.useHardwareDepth(true);
    active.place([0, 0, 0], [10, 0, 1]);
    active.useHardwareDepth(false);
    expect(active.object.children).toHaveLength(2);
    expect(active.materials).toHaveLength(2);
    expect(visible(active)).toEqual([true, true]);
    for (const material of active.materials) {
      expect(material.depthWrite).toBe(false);
      expect(material.blending).toBe(three.NoBlending);
      expect(compiled(material).fragmentShader).not.toContain('gl_FragDepth');
    }
  });

  it('exposes all materials for resize/clipping and disposes both the visible and hidden pairs', () => {
    const active = current();
    const strokes = active.object.children as LineSegments2[];
    const planes = [new three.Plane(new three.Vector3(1, 0, 0), -2)];
    const disposals = active.materials.map((material) => vi.spyOn(material, 'dispose'));
    for (const material of active.materials) {
      material.resolution.set(1600, 1200);
      material.clippingPlanes = planes;
    }
    for (const [index, stroke] of strokes.entries()) {
      expect(stroke.material).toBe(active.materials[index]);
      expect(stroke.material.resolution).toEqual(new three.Vector2(1600, 1200));
      expect(stroke.material.clippingPlanes).toBe(planes);
    }
    disposeChildren(active.object);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(active.object.children).toHaveLength(0);
  });

  it('copies parent hooks and captures hardware cache identity before the source hook changes', () => {
    const hooks: { cell: { value: number }; key: string; render: ReturnType<typeof vi.fn> }[] = [];
    class ParentMaterial extends LineMaterial {
      constructor(parameters?: ConstructorParameters<typeof LineMaterial>[0]) {
        super(parameters);
        const cell = { value: hooks.length + 1 };
        const render = vi.fn();
        this.onBeforeCompile = (shader) => {
          shader.uniforms.parentCell = cell;
        };
        this.onBeforeRender = render;
        // This callback closes over the original material, so copying it alone
        // would read that material's later XY-depth callback and change the key.
        this.customProgramCacheKey = () => cell.value + ':' + this.onBeforeCompile.toString();
        hooks.push({ cell, key: this.customProgramCacheKey(), render });
      }
    }
    const active = current(false, ParentMaterial);
    for (const [exact, hardware] of [
      [0, 2],
      [1, 3],
    ] as const) {
      expect(compiled(active.materials[exact]!).uniforms.parentCell).toBe(hooks[exact]?.cell);
      expect(compiled(active.materials[hardware]!).uniforms.parentCell).toBe(hooks[exact]?.cell);
      expect(active.materials[hardware]?.customProgramCacheKey()).toBe(hooks[exact]?.key);
      expect(active.materials[hardware]?.onBeforeRender).toBe(hooks[exact]?.render);
    }
  });

  it('tracks the cached completed split guard through paused colours and fading from move zero', () => {
    const active = current();
    const { batches, colors, trail } = completed();
    active.place([0, 0, 0], [10, 0, 1]);
    const sync = () => active.useHardwareDepth(batches.split);
    expect(batches.split).toBe(true);
    sync();
    expect(visible(active)).toEqual([false, false, true, true]);
    colors[4] = 10001;
    expect(batches.split).toBe(true);
    batches.refreshColors();
    expect(batches.split).toBe(false);
    sync();
    expect(visible(active)).toEqual([true, true, false, false]);
    colors[4] = 10000;
    batches.refreshColors();
    setTrail(trail, 0, 1, [0.1, 0.2, 0.3]);
    expect(batches.split).toBe(false);
    sync();
    expect(visible(active)).toEqual([true, true, false, false]);
    setTrail(trail, 0, 1, null);
    expect(batches.split).toBe(true);
    sync();
    expect(visible(active)).toEqual([false, false, true, true]);
  });
});
