import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDepthBatches, type DepthBatches } from './line-depth-batches';
import { editLineMaterial, MAIN, withShownMoves } from './line-shader-edits';
import { addTrail, setTrail } from './line-trail';
import { createProgramGeometry, shareProgramGeometry } from './program-lines';

const geometries = new Set<LineSegmentsGeometry>();
const materials = new Set<LineMaterial>();
afterEach(() => {
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  geometries.clear();
  materials.clear();
});

function sourceScene() {
  // A horizontal move, a genuine ramp, then a horizontal move on a second plane.
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 20, 0, 1, 20, 0, 1, 30, 0, 1]);
  const colors = new Uint16Array([
    50000, 15000, 3000, 65535, 50000, 15000, 3000, 65535, 50000, 15000, 3000, 65535,
  ]);
  const { geometry } = createProgramGeometry(three, LineSegmentsGeometry, positions, colors);
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
  geometries.add(geometry);
  geometries.add(ghost.geometry);
  const build = () => {
    const batches = createDepthBatches({ three, LineSegments2, lines, ghost, trail, colors });
    for (const entry of batches.materials) materials.add(entry);
    return batches;
  };
  return { positions, colors, geometry, lines, ghost, trail, build };
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

function visible(batches: DepthBatches) {
  return batches.objects.map((object) => object.visible);
}

function lodGeometry() {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array([0, 0, 0, 30, 0, 1]));
  geometries.add(geometry);
  return geometry;
}

function beforeRender(object: LineSegments2, viewport = vi.fn()) {
  const renderer = {
    getCurrentViewport: (target: three.Vector4) => {
      viewport();
      return target.set(0, 0, 800, 600);
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

describe('program-wide cached colour and fade guard', () => {
  it('uses split meshes only until a whole-program repaint discovers a different colour', () => {
    const source = sourceScene();
    const batches = source.build();
    batches.ghost.visible = true;
    expect(visible(batches)).toEqual([false, false, true, true, true, true]);
    source.geometry.instanceCount = 1;
    // An unrevealed move still matters. sync must not rescan this array per frame.
    source.colors[8] = 50001;
    batches.sync();
    expect(visible(batches)).toEqual([false, false, true, true, true, true]);
    batches.refreshColors();
    expect(visible(batches)).toEqual([true, true, false, false, false, false]);
    source.colors[8] = 50000;
    batches.refreshColors();
    expect(visible(batches)).toEqual([false, false, true, true, true, true]);
  });

  it.each([0, 1, 2])('rejects a single Uint16 difference in RGB channel %s', (channel) => {
    const source = sourceScene();
    source.colors[4 + channel] = (source.colors[4 + channel] ?? 0) + 1;
    expect(visible(source.build())).toEqual([true, false, false, false, false, false]);
  });

  it('ignores colours of hidden moves but conservatively retains originals when none are shown', () => {
    const source = sourceScene();
    source.colors[4] = 1;
    source.colors[7] = 0;
    const batches = source.build();
    expect(visible(batches)).toEqual([false, false, true, true, false, false]);
    source.colors[3] = 0;
    source.colors[11] = 0;
    batches.refreshColors();
    expect(visible(batches)).toEqual([true, false, false, false, false, false]);
  });

  it('changes modes before render collection when trail fading starts at move zero', () => {
    const source = sourceScene();
    const batches = source.build();
    batches.ghost.visible = true;
    setTrail(source.trail, 0, 2, [0.1, 0.2, 0.3]);
    batches.sync();
    expect(visible(batches)).toEqual([true, true, false, false, false, false]);
    setTrail(source.trail, 0, 2, null);
    batches.sync();
    expect(visible(batches)).toEqual([false, false, true, true, true, true]);
  });
});

describe('shared geometry and visibility aliases', () => {
  it('keeps original meshes first and creates materials rather than position or colour copies', () => {
    const source = sourceScene();
    const batches = source.build();
    expect(batches.objects.slice(0, 2)).toEqual([source.lines, source.ghost]);
    expect(new Set(batches.objects).size).toBe(6);
    expect(new Set(batches.materials).size).toBe(6);
    expect(new Set(batches.objects.map((object) => object.name)).size).toBe(6);
    for (const index of [0, 2, 3]) expect(batches.objects[index]?.geometry).toBe(source.geometry);
    for (const index of [1, 4, 5])
      expect(batches.objects[index]?.geometry).toBe(source.ghost.geometry);
    expect(source.ghost.geometry.getAttribute('instanceStart')).toBe(
      source.geometry.getAttribute('instanceStart'),
    );
    source.geometry.instanceCount = 2;
    for (const index of [0, 2, 3]) expect(batches.objects[index]?.geometry.instanceCount).toBe(2);
    for (const index of [1, 4, 5]) expect(batches.objects[index]?.geometry.instanceCount).toBe(3);
  });

  it('swaps all variants through LOD proxies while retaining the independent full reveal geometry', () => {
    const source = sourceScene();
    const batches = source.build();
    const fullGhost = source.ghost.geometry;
    const solidLod = lodGeometry();
    const ghostLod = lodGeometry();
    batches.lines.geometry = solidLod;
    batches.ghost.geometry = ghostLod;
    for (const index of [0, 2, 3]) expect(batches.objects[index]?.geometry).toBe(solidLod);
    for (const index of [1, 4, 5]) expect(batches.objects[index]?.geometry).toBe(ghostLod);
    source.geometry.instanceCount = 2;
    expect(solidLod.instanceCount).toBe(1);
    expect(fullGhost.instanceCount).toBe(3);
    batches.lines.geometry = source.geometry;
    batches.ghost.geometry = fullGhost;
    expect(batches.lines.geometry).toBe(source.geometry);
    expect(batches.ghost.geometry).toBe(fullGhost);
    for (const index of [0, 2, 3]) expect(batches.objects[index]?.geometry.instanceCount).toBe(2);
  });

  it('preserves logical ghost visibility across fallback and split transitions', () => {
    const source = sourceScene();
    const batches = source.build();
    batches.ghost.visible = true;
    expect(batches.ghost.visible).toBe(true);
    expect(source.ghost.visible).toBe(false);
    source.colors[0] = 3;
    batches.refreshColors();
    expect(batches.ghost.visible).toBe(true);
    expect(source.ghost.visible).toBe(true);
    batches.ghost.visible = false;
    source.colors[0] = 50000;
    batches.refreshColors();
    expect(batches.ghost.visible).toBe(false);
    for (const index of [1, 4, 5]) expect(batches.objects[index]?.visible).toBe(false);
  });

  it('keeps render order, clipping changes and object callbacks consistent across variants', () => {
    const source = sourceScene();
    const objectHook = vi.fn();
    source.lines.onBeforeRender = objectHook;
    const batches = source.build();
    const planes = [new three.Plane(new three.Vector3(1, 0, 0), -2)];
    for (const original of [source.lines, source.ghost]) {
      original.material.clippingPlanes = planes;
      original.material.clipIntersection = true;
      original.material.clipShadows = true;
      original.renderOrder += 10;
    }
    batches.sync();
    for (const index of [0, 2, 3]) {
      expect(batches.objects[index]?.renderOrder).toBe(11);
      expect(batches.objects[index]?.onBeforeRender).toBe(objectHook);
    }
    for (const index of [1, 4, 5]) expect(batches.objects[index]?.renderOrder).toBe(9);
    for (const material of batches.materials) {
      expect(material.clippingPlanes).toBe(planes);
      expect(material.clipIntersection).toBe(true);
      expect(material.clipShadows).toBe(true);
    }
  });
});

describe('real LineMaterial shader and callback composition', () => {
  it('keeps trail/shown edits and exact uniform cells while ramp programs never write fragment depth', () => {
    const source = sourceScene();
    const batches = source.build();
    expect(
      new Set(batches.materials.map((material) => material.customProgramCacheKey())).size,
    ).toBe(6);
    for (const index of [0, 2, 3]) {
      const shader = compiled(batches.materials[index]!);
      expect(shader.uniforms.trailStart).toBe(source.trail.trailStart);
      expect(shader.uniforms.trailEnd).toBe(source.trail.trailEnd);
      expect(shader.uniforms.trailFade).toBe(source.trail.trailFade);
      expect(shader.uniforms.trailFadeColor).toBe(source.trail.trailFadeColor);
      expect(shader.vertexShader).toContain('instanceShown');
    }
    for (const index of [0, 1, 2, 4])
      expect(compiled(batches.materials[index]!).fragmentShader).toContain('gl_FragDepth');
    for (const index of [3, 5]) {
      const shader = compiled(batches.materials[index]!);
      expect(shader.fragmentShader).not.toContain('gl_FragDepth');
      expect(shader.vertexShader).toContain('instanceShown');
      const rejection = shader.vertexShader.indexOf('instanceStart.z == instanceEnd.z');
      expect(rejection).toBeGreaterThan(shader.vertexShader.indexOf(MAIN));
      expect(rejection).toBeLessThan(
        shader.vertexShader.indexOf('float aspect = resolution.x / resolution.y;'),
      );
    }
    for (const index of [2, 4])
      expect(compiled(batches.materials[index]!).vertexShader).toContain(
        'instanceStart.z != instanceEnd.z',
      );
  });

  it('rejects opposite classes before extrusion and preserves accepted shader arithmetic exactly', () => {
    const source = sourceScene();
    const baseSolid = compiled(source.lines.material);
    const baseGhost = compiled(source.ghost.material);
    const batches = source.build();
    for (const { index, accepted, comparison, kind } of [
      { index: 2, accepted: compiled(batches.materials[0]!), comparison: '!=', kind: 'constant' },
      { index: 3, accepted: baseSolid, comparison: '==', kind: 'ramp' },
      { index: 4, accepted: compiled(batches.materials[1]!), comparison: '!=', kind: 'constant' },
      { index: 5, accepted: baseGhost, comparison: '==', kind: 'ramp' },
    ]) {
      const material = batches.materials[index]!;
      const shader = compiled(material);
      const mainEnd = shader.vertexShader.indexOf(MAIN) + MAIN.length;
      const block = shader.vertexShader
        .slice(mainEnd)
        .match(/^\n\s*if \( instanceStart\.z (!=|==) instanceEnd\.z \) \{\n[\s\S]*?\n\s*\}\n/)?.[0];
      expect(block, 'opposite-class rejection must be the first statement in main').toBeDefined();
      expect(block).toContain('instanceStart.z ' + comparison + ' instanceEnd.z');
      expect(block).toMatch(/gl_Position = vec4\( 0\.0, 0\.0, 2\.0, 1\.0 \);[\s\S]*return;/);
      const extrusion = shader.vertexShader.indexOf('float aspect = resolution.x / resolution.y;');
      expect(extrusion).toBeGreaterThan(mainEnd);
      expect(mainEnd + block!.length).toBeLessThan(extrusion);
      expect(
        shader.vertexShader.slice(0, mainEnd) + shader.vertexShader.slice(mainEnd + block!.length),
      ).toBe(accepted.vertexShader);
      expect(shader.fragmentShader).toBe(accepted.fragmentShader);
      expect(material.customProgramCacheKey()).toContain('-depth-batch-early-' + kind);
    }
  });

  it('explicitly retains custom parent compile/render/cache hooks lost by Material.clone', () => {
    const source = sourceScene();
    const material = source.lines.material;
    const compile = material.onBeforeCompile;
    const cell = { value: 7 };
    const parentCompile = vi.fn(function (this: LineMaterial, ...args: Parameters<typeof compile>) {
      compile.call(this, ...args);
      args[0].uniforms.parentCell = cell;
    });
    const parentRender = vi.fn();
    material.onBeforeCompile = parentCompile;
    material.onBeforeRender = parentRender;
    material.customProgramCacheKey = () => 'custom-parent';
    const batches = source.build();
    for (const index of [0, 2, 3]) {
      const object = batches.objects[index]!;
      expect(compiled(object.material).uniforms.parentCell).toBe(cell);
      expect(object.material.customProgramCacheKey()).toContain('custom-parent');
      const viewport = beforeRender(object);
      expect(viewport).toHaveBeenCalledTimes(index === 3 ? 0 : 1);
    }
    expect(parentCompile.mock.contexts).toEqual([
      batches.materials[0],
      batches.materials[2],
      batches.materials[3],
    ]);
    expect(parentRender.mock.contexts).toEqual(parentCompile.mock.contexts);
  });
});

describe('conservative completed ghost range', () => {
  it('shares trail bounds after the exact plane decision and never edits a ramp ghost', () => {
    const source = sourceScene();
    const batches = source.build();
    for (const index of [1, 4]) {
      const shader = compiled(batches.materials[index]!);
      expect(shader.uniforms.kerfdeskCoveredStart).toBe(source.trail.trailStart);
      expect(shader.uniforms.kerfdeskCoveredEnd).toBe(source.trail.trailEnd);
      expect(shader.vertexShader.indexOf('kerfdeskCoveredEnabled > 0.5')).toBeGreaterThan(
        shader.vertexShader.indexOf('if ( instanceStart.z == instanceEnd.z )'),
      );
      expect(shader.vertexShader).toContain('abs( vKerfdeskXYPlane.z ) > 1e-8');
    }
    const ramp = compiled(batches.materials[5]!);
    expect(ramp.uniforms.kerfdeskCoveredStart).toBeUndefined();
    expect(ramp.fragmentShader).not.toContain('gl_FragDepth');
  });

  it('enables covered full geometry with a visible solid, disabling it for either LOD geometry', () => {
    const source = sourceScene();
    const batches = source.build();
    batches.ghost.visible = true;
    const fullGhost = source.ghost.geometry;
    const exactGhost = batches.objects[4]!;
    const shader = compiled(exactGhost.material);
    const enabled = () => {
      beforeRender(exactGhost);
      return shader.uniforms.kerfdeskCoveredEnabled?.value;
    };
    expect(source.lines.visible).toBe(false);
    expect(enabled()).toBe(1);
    batches.lines.geometry = lodGeometry();
    expect(enabled()).toBe(0);
    batches.lines.geometry = source.geometry;
    expect(enabled()).toBe(1);
    batches.ghost.geometry = lodGeometry();
    expect(enabled()).toBe(0);
    batches.ghost.geometry = fullGhost;
    expect(enabled()).toBe(1);
    for (const index of [0, 2, 3]) batches.objects[index]!.visible = false;
    expect(enabled()).toBe(0);
  });

  it.each(['narrow', 'transparent', 'opacity'] as const)(
    'keeps ghost coverage when the completed source is %s',
    (change) => {
      const source = sourceScene();
      if (change === 'narrow') source.lines.material.linewidth = 0.5;
      if (change === 'transparent') source.lines.material.transparent = true;
      if (change === 'opacity') source.lines.material.opacity = 0.9;
      const batches = source.build();
      const exactGhost = batches.objects[4]!;
      const shader = compiled(exactGhost.material);
      beforeRender(exactGhost);
      expect(shader.uniforms.kerfdeskCoveredEnabled?.value).toBe(0);
    },
  );
});
