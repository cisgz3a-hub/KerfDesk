import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEPTH_PLANE_ATTRIBUTE } from './line-depth-plane-geometry';
import { createCurrentMove } from './scene-current-move';
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

function compiled(material: LineMaterial) {
  const shader = {
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe('active move shared physical writer', () => {
  it('keeps one casing/core pair and one position/plane buffer for every ramp', () => {
    const active = current();
    const strokes = active.object.children as LineSegments2[];
    expect(strokes).toHaveLength(2);
    expect(active.materials.map((material) => material.linewidth)).toEqual([8, 4]);
    expect(active.materials.map((material) => material.depthWrite)).toEqual([false, true]);
    expect(strokes.map((stroke) => stroke.renderOrder)).toEqual([3, 4]);
    expect(strokes.map((stroke) => stroke.name)).toEqual([
      'toolpath-current-exact-casing',
      'toolpath-current-exact-core',
    ]);
    expect(new Set(strokes.map((stroke) => stroke.geometry)).size).toBe(1);
    for (const stroke of strokes) {
      expect(stroke.visible).toBe(true);
      expect(stroke.frustumCulled).toBe(false);
      expect(stroke.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array).toBeInstanceOf(
        Float32Array,
      );
      expect(compiled(stroke.material).fragmentShader).toContain('gl_FragDepth = planeDepth');
    }
  });

  it('derives depth from the actual placed Float32 endpoints and uploads only that short move', () => {
    const active = current();
    const buffer = active.positions();
    const stroke = active.object.children[0] as LineSegments2;
    const plane = stroke.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE) as three.BufferAttribute;
    const coefficients = plane.array;
    const initialVersion = plane.version;
    active.place([0, 0, 0], [50, 0, 0.5]);
    expect([...coefficients]).toEqual([Math.fround(-0.01), 0, 1, 0]);
    active.useHardwareDepth(true);
    expect(active.object.children.map((child) => child.visible)).toEqual([true, true]);
    active.place([0, 0, 1], [10, 0, 1 + 2e-8]);
    expect(buffer[2]).toBe(buffer[5]);
    expect([...coefficients]).toEqual([0, 0, 1, -1]);
    active.place([0, 0, 1], [10, 0, 1 + 2 ** -22]);
    expect(coefficients[0]).toBe(Math.fround(-(2 ** -22) / 10));
    expect(active.positions()).toBe(buffer);
    expect(plane.array).toBe(coefficients);
    expect(coefficients).toHaveLength(4);
    expect(plane.version).toBe(initialVersion + 3);
    expect(active.object.children.map((child) => child.visible)).toEqual([true, true]);
  });

  it('retains the full stored source plane when a non-dyadic prefix endpoint rounds', () => {
    const active = current();
    active.place([1, 0, 0], [1.4, 0.4, 0.4], new Float32Array([2, 1, 1]));
    const stroke = active.object.children[0] as LineSegments2;
    expect([...active.positions()]).toEqual([
      1,
      0,
      0,
      Math.fround(1.4),
      Math.fround(0.4),
      Math.fround(0.4),
    ]);
    expect([...stroke.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array]).toEqual([
      -0.5, -0.5, 1, 0.5,
    ]);
    active.place([2, 1, 1], [1.4, 0.4, 0.4], new Float32Array([1, 0, 0]));
    expect([...stroke.geometry.getAttribute(DEPTH_PLANE_ATTRIBUTE).array]).toEqual([
      -0.5, -0.5, 1, 0.5,
    ]);
  });

  it('leaves the planar ordered draw on two original materials without a depth writer', () => {
    const active = current(true);
    active.useHardwareDepth(true);
    active.place([0, 0, 0], [10, 0, 1]);
    expect(active.object.children).toHaveLength(2);
    for (const material of active.materials) {
      expect(material.depthWrite).toBe(false);
      expect(material.blending).toBe(three.NoBlending);
      expect(compiled(material).fragmentShader).not.toContain('gl_FragDepth');
    }
  });

  it('exposes every material to resize/clipping and disposes the entire pair once', () => {
    const active = current();
    const planes = [new three.Plane(new three.Vector3(1, 0, 0), -2)];
    const disposals = active.materials.map((material) => vi.spyOn(material, 'dispose'));
    for (const material of active.materials) {
      material.resolution.set(1600, 1200);
      material.clippingPlanes = planes;
    }
    for (const child of active.object.children as LineSegments2[]) {
      expect(child.material.resolution).toEqual(new three.Vector2(1600, 1200));
      expect(child.material.clippingPlanes).toBe(planes);
    }
    disposeChildren(active.object);
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
    expect(active.object.children).toHaveLength(0);
  });

  it('composes each parent compile/render hook exactly once without material clones', () => {
    const hooks: { cell: { value: number }; render: ReturnType<typeof vi.fn> }[] = [];
    class ParentMaterial extends LineMaterial {
      constructor(parameters?: ConstructorParameters<typeof LineMaterial>[0]) {
        super(parameters);
        const cell = { value: hooks.length + 1 },
          render = vi.fn();
        this.onBeforeCompile = (shader) => {
          shader.uniforms.parentCell = cell;
        };
        this.onBeforeRender = render;
        this.customProgramCacheKey = () => 'custom-parent';
        hooks.push({ cell, render });
      }
    }
    const active = current(false, ParentMaterial);
    expect(hooks).toHaveLength(2);
    const renderer = { getCurrentViewport: (value: three.Vector4) => value.set(0, 0, 800, 600) };
    for (const [index, child] of (active.object.children as LineSegments2[]).entries()) {
      expect(compiled(child.material).uniforms.parentCell).toBe(hooks[index]?.cell);
      expect(child.material.customProgramCacheKey()).toBe(
        'custom-parent-physical-origin-plane-depth-fat',
      );
      child.material.onBeforeRender(
        renderer as never,
        new three.Scene(),
        new three.Camera(),
        child.geometry,
        child,
        {} as never,
      );
      expect(hooks[index]?.render).toHaveBeenCalledOnce();
    }
  });
});
