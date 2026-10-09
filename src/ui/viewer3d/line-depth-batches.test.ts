import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDepthBatches } from './line-depth-batches';
import { editLineMaterial, withShownMoves } from './line-shader-edits';
import { addTrail, setTrail } from './line-trail';
import { createProgramGeometry, shareProgramGeometry, writeProgramColors } from './program-lines';

const geometries = new Set<LineSegmentsGeometry>();
const materials = new Set<LineMaterial>();
afterEach(() => {
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  geometries.clear();
  materials.clear();
});

function sourceScene() {
  // Constant-Z, varying-Z, then constant-Z on another plane, in program order.
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 20, 0, 1, 20, 0, 1, 30, 0, 1]);
  const colors = new Uint16Array([
    50000, 15000, 3000, 65535, 50000, 15000, 3000, 65535, 50000, 15000, 3000, 65535,
  ]);
  const { geometry, colorBuffer } = createProgramGeometry(
    three,
    LineSegmentsGeometry,
    positions,
    colors,
  );
  const material = new LineMaterial({ vertexColors: true, linewidth: 2.5 });
  const trail = addTrail(three, material);
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = 1;
  const ghostMaterial = new LineMaterial({
    linewidth: 1,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthFunc: three.LessDepth,
  });
  editLineMaterial(ghostMaterial, 'ghost-shown', withShownMoves);
  const ghost = new LineSegments2(
    shareProgramGeometry(LineSegmentsGeometry, geometry),
    ghostMaterial,
  );
  ghost.renderOrder = -1;
  ghost.visible = false;
  for (const entry of [geometry, ghost.geometry]) geometries.add(entry);
  for (const entry of [material, ghostMaterial]) materials.add(entry);
  const build = () => createDepthBatches({ three, LineSegments2, lines, ghost, trail, colors });
  return { positions, colors, geometry, colorBuffer, lines, ghost, trail, build };
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

function programAttribute(geometry: LineSegmentsGeometry, name: string) {
  return geometry.getAttribute(name) as three.InterleavedBufferAttribute;
}

function beforeRender(object: LineSegments2, viewport = vi.fn()) {
  const renderer = {
    getCurrentViewport: (value: three.Vector4) => {
      viewport();
      return value.set(0, 0, 800, 600);
    },
  };
  object.material.onBeforeRender(
    renderer as never,
    new three.Scene(),
    new three.Camera(),
    object.geometry,
    object,
    {} as never,
  );
  return viewport;
}

function lodGeometry() {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array([0, 0, 0, 30, 0, 1]));
  geometries.add(geometry);
  return geometry;
}

describe('original program-order strokes', () => {
  it('keeps mixed depth classes in one original draw with the original buffers and two materials', () => {
    const source = sourceScene();
    const solidClone = vi.spyOn(source.lines.material, 'clone');
    const ghostClone = vi.spyOn(source.ghost.material, 'clone');
    const batches = source.build();
    expect(batches.objects).toEqual([source.lines, source.ghost]);
    expect(batches.materials).toEqual([source.lines.material, source.ghost.material]);
    expect(batches.lines).toBe(source.lines);
    expect(batches.ghost).toBe(source.ghost);
    expect(batches.split).toBe(false);
    expect(solidClone).not.toHaveBeenCalled();
    expect(ghostClone).not.toHaveBeenCalled();
    expect(batches.objects.map((object) => object.name)).toEqual([
      'toolpath-solid-depth-fallback',
      'toolpath-ghost-depth-fallback',
    ]);
    const position = programAttribute(batches.lines.geometry, 'instanceStart');
    expect(position.data.array.buffer).toBe(source.positions.buffer);
    expect([...position.data.array]).toEqual([...source.positions]);
    expect(programAttribute(batches.lines.geometry, 'instanceColorStart').data.array).toBe(
      source.colors,
    );
    expect(batches.ghost.geometry.getAttribute('instanceStart')).toBe(position);
    source.geometry.instanceCount = 2;
    expect(batches.lines.geometry.instanceCount).toBe(2);
    expect(batches.ghost.geometry.instanceCount).toBe(3);
  });

  it('recolours an unrevealed move in place without changing draw order, buffers or visibility', () => {
    const source = sourceScene();
    const batches = source.build();
    const positions = programAttribute(source.geometry, 'instanceStart').data.array;
    const colours = programAttribute(source.geometry, 'instanceColorStart');
    const version = colours.data.version;
    source.geometry.instanceCount = 1;
    batches.ghost.visible = true;
    writeProgramColors(source.colors, (index) => (index === 2 ? [1, 0, 0] : [0, 0, 1]));
    source.colorBuffer.needsUpdate = true;
    batches.refreshColors();
    batches.sync();
    expect(colours.data.array).toBe(source.colors);
    expect(colours.data.version).toBe(version + 1);
    expect([...source.colors.slice(8, 12)]).toEqual([65535, 0, 0, 65535]);
    expect(programAttribute(source.geometry, 'instanceStart').data.array).toBe(positions);
    expect(batches.objects).toEqual([source.lines, source.ghost]);
    expect(batches.objects.map((object) => object.visible)).toEqual([true, true]);
    expect(source.geometry.instanceCount).toBe(1);
    expect(batches.split).toBe(false);
  });

  it('retains hidden/future shown flags rather than rebuilding or sorting their instances', () => {
    const source = sourceScene();
    source.colors[7] = 0;
    source.colors[8] = 1;
    const batches = source.build();
    source.geometry.instanceCount = 1;
    batches.refreshColors();
    batches.sync();
    const shown = programAttribute(source.geometry, 'instanceShown');
    expect(shown.data.array).toBe(source.colors);
    expect(shown.getX(0)).toBe(1);
    expect(shown.getX(1)).toBe(0);
    expect(shown.getX(2)).toBe(1);
    expect(compiled(batches.lines.material).vertexShader).toContain('instanceShown < 0.5');
    expect(batches.lines.geometry.instanceCount).toBe(1);
    expect(batches.split).toBe(false);
  });

  it.each([0, 1])('shares fading uniforms with the original draw from move %s', (start) => {
    const source = sourceScene();
    const batches = source.build();
    const shader = compiled(batches.lines.material);
    source.geometry.instanceCount = 2;
    batches.ghost.visible = true;
    setTrail(source.trail, start, 2, [0.1, 0.2, 0.3]);
    batches.sync();
    batches.refreshColors();
    expect(shader.uniforms.trailStart).toBe(source.trail.trailStart);
    expect(shader.uniforms.trailEnd).toBe(source.trail.trailEnd);
    expect(shader.uniforms.trailFade).toBe(source.trail.trailFade);
    expect(shader.uniforms.trailFadeColor).toBe(source.trail.trailFadeColor);
    expect(shader.uniforms.trailStart?.value).toBe(start);
    expect(shader.uniforms.trailEnd?.value).toBe(2);
    expect(shader.uniforms.trailFade?.value).toBe(0.7);
    expect(batches.objects.map((object) => object.visible)).toEqual([true, true]);
    expect(batches.split).toBe(false);
    setTrail(source.trail, 0, 2, null);
    batches.sync();
    expect(shader.uniforms.trailFade?.value).toBe(0);
    expect(batches.split).toBe(false);
  });
});

describe('direct LOD, visibility and clipping state', () => {
  it('swaps original drawings while retaining full reveal counts and shared full buffers', () => {
    const source = sourceScene();
    const batches = source.build();
    const fullGhost = source.ghost.geometry,
      solidLod = lodGeometry(),
      ghostLod = lodGeometry();
    batches.lines.geometry = solidLod;
    batches.ghost.geometry = ghostLod;
    expect(source.lines.geometry).toBe(solidLod);
    expect(source.ghost.geometry).toBe(ghostLod);
    source.geometry.instanceCount = 2;
    expect(solidLod.instanceCount).toBe(1);
    expect(fullGhost.instanceCount).toBe(3);
    batches.lines.geometry = source.geometry;
    batches.ghost.geometry = fullGhost;
    expect(batches.lines.geometry.instanceCount).toBe(2);
    expect(batches.ghost.geometry.instanceCount).toBe(3);
    expect(fullGhost.getAttribute('instanceStart')).toBe(
      source.geometry.getAttribute('instanceStart'),
    );
  });

  it('keeps both original visibility values through recolour/fade synchronization', () => {
    const source = sourceScene();
    const batches = source.build();
    for (const value of [true, false, true]) {
      batches.ghost.visible = value;
      batches.lines.visible = !value;
      source.colors[0] = value ? 1 : 50000;
      setTrail(source.trail, 0, 2, value ? [0.1, 0.2, 0.3] : null);
      batches.refreshColors();
      batches.sync();
      expect(source.ghost.visible).toBe(value);
      expect(source.lines.visible).toBe(!value);
      expect(batches.split).toBe(false);
    }
  });

  it('keeps clipping and render-order changes on the same materials and object callbacks', () => {
    const source = sourceScene();
    const objectHook = vi.fn();
    source.lines.onBeforeRender = objectHook;
    const batches = source.build();
    const planes = [new three.Plane(new three.Vector3(1, 0, 0), -2)];
    for (const original of [source.lines, source.ghost]) {
      original.material.clippingPlanes = planes;
      original.material.clipIntersection = true;
      original.material.clipShadows = true;
      original.material.clipping = true;
      original.renderOrder += 10;
    }
    batches.sync();
    expect(batches.lines.onBeforeRender).toBe(objectHook);
    expect(batches.objects.map((object) => object.renderOrder)).toEqual([11, 9]);
    for (const material of batches.materials) {
      expect(material.clippingPlanes).toBe(planes);
      expect(material.clipIntersection).toBe(true);
      expect(material.clipShadows).toBe(true);
      expect(material.clipping).toBe(true);
    }
  });
});

describe('original material depth and parent hooks', () => {
  it.each(['lines', 'ghost'] as const)(
    'composes %s compile/render/cache hooks without cloning',
    (role) => {
      const source = sourceScene(),
        material = source[role].material;
      const compile = material.onBeforeCompile,
        cell = { value: 7 };
      const parentCompile = vi.fn(function (
        this: LineMaterial,
        ...args: Parameters<typeof compile>
      ) {
        compile.call(this, ...args);
        args[0].uniforms.parentCell = cell;
      });
      const order: string[] = [];
      const parentRender = vi.fn(() => order.push('parent'));
      material.onBeforeCompile = parentCompile;
      material.onBeforeRender = parentRender;
      material.customProgramCacheKey = () => 'custom-parent-' + role;
      const batches = source.build(),
        object = batches[role],
        shader = compiled(object.material);
      expect(shader.uniforms.parentCell).toBe(cell);
      expect(shader.fragmentShader).toContain('gl_FragDepth');
      expect(shader.vertexShader).toContain('instanceShown');
      expect(material.customProgramCacheKey()).toContain('custom-parent-' + role);
      expect(material.customProgramCacheKey()).not.toContain('depth-batch-early');
      const viewport = beforeRender(
        object,
        vi.fn(() => order.push('viewport')),
      );
      expect(viewport).toHaveBeenCalledOnce();
      expect(order).toEqual(['parent', 'viewport']);
      expect(parentCompile.mock.contexts).toEqual([material]);
      expect(parentRender.mock.contexts).toEqual([material]);
    },
  );
});

describe('conservative completed constant-Z ghost range', () => {
  it('shares live trail bounds and keeps coverage after the constant-Z plane decision', () => {
    const source = sourceScene(),
      batches = source.build(),
      shader = compiled(batches.ghost.material);
    expect(shader.uniforms.kerfdeskCoveredStart).toBe(source.trail.trailStart);
    expect(shader.uniforms.kerfdeskCoveredEnd).toBe(source.trail.trailEnd);
    const cullAt = shader.vertexShader.indexOf('kerfdeskCoveredEnabled > 0.5');
    expect(cullAt).toBeGreaterThan(shader.vertexShader.lastIndexOf('vKerfdeskXYPlane ='));
    const cull = shader.vertexShader.slice(cullAt);
    expect(cull).toContain('instanceStart.z == instanceEnd.z');
    expect(cull).toContain('abs( vKerfdeskXYPlane.z ) > 1e-8');
    expect(cull).toContain('float( gl_InstanceID ) >= kerfdeskCoveredStart');
    expect(cull).toContain('float( gl_InstanceID ) < kerfdeskCoveredEnd');
    setTrail(source.trail, 1, 2, null);
    expect(shader.uniforms.kerfdeskCoveredStart?.value).toBe(1);
    expect(shader.uniforms.kerfdeskCoveredEnd?.value).toBe(2);
    expect(batches.ghost.material.depthFunc).toBe(three.LessDepth);
    expect(batches.ghost.material.depthWrite).toBe(false);
  });

  it('disables coverage for either LOD or a shared-attribute replacement and restores it on full geometry', () => {
    const source = sourceScene(),
      batches = source.build(),
      fullGhost = source.ghost.geometry;
    batches.ghost.visible = true;
    const shader = compiled(batches.ghost.material);
    const enabled = () => {
      beforeRender(batches.ghost);
      return shader.uniforms.kerfdeskCoveredEnabled?.value;
    };
    expect(enabled()).toBe(1);
    batches.lines.geometry = lodGeometry();
    expect(enabled()).toBe(0);
    batches.lines.geometry = source.geometry;
    expect(enabled()).toBe(1);
    batches.ghost.geometry = lodGeometry();
    expect(enabled()).toBe(0);
    const shared = shareProgramGeometry(LineSegmentsGeometry, fullGhost);
    geometries.add(shared);
    batches.ghost.geometry = shared;
    expect(enabled()).toBe(0);
    batches.ghost.geometry = fullGhost;
    expect(enabled()).toBe(1);
    source.lines.material.linewidth = source.ghost.material.linewidth;
    expect(enabled()).toBe(1);
  });

  it.each(['hidden', 'narrow', 'transparent', 'opacity'] as const)(
    'retains ghost coverage when the completed source is %s',
    (change) => {
      const source = sourceScene(),
        batches = source.build(),
        shader = compiled(batches.ghost.material);
      if (change === 'hidden') source.lines.visible = false;
      if (change === 'narrow') source.lines.material.linewidth = 0.5;
      if (change === 'transparent') source.lines.material.transparent = true;
      if (change === 'opacity') source.lines.material.opacity = 0.9;
      beforeRender(batches.ghost);
      expect(shader.uniforms.kerfdeskCoveredEnabled?.value).toBe(0);
    },
  );

  it('checks live coverage eligibility after the original ghost material render callback', () => {
    const source = sourceScene();
    const parent = vi.fn(() => {
      source.lines.visible = false;
    });
    source.ghost.material.onBeforeRender = parent;
    const batches = source.build(),
      shader = compiled(batches.ghost.material);
    beforeRender(batches.ghost);
    expect(parent).toHaveBeenCalledOnce();
    expect(shader.uniforms.kerfdeskCoveredEnabled?.value).toBe(0);
  });
});
