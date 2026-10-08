import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDepthBatches } from './line-depth-batches';
import { installGhostTail, type GhostTailState } from './line-ghost-tail';
import { editLineMaterial, MAIN, withShownMoves } from './line-shader-edits';
import { addTrail } from './line-trail';
import { createProgramGeometry, shareProgramGeometry } from './program-lines';

const geometries = new Set<three.BufferGeometry>();
const materials = new Set<three.Material>();
afterEach(() => {
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  geometries.clear();
  materials.clear();
});

function scene() {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 10, 0, 0, 20, 0, 1]);
  const colors = new Uint16Array([10000, 20000, 60000, 65535, 10000, 20000, 60000, 65535]);
  const { geometry } = createProgramGeometry(three, LineSegmentsGeometry, positions, colors);
  const material = new LineMaterial({ linewidth: 2.5, vertexColors: true });
  const trail = addTrail(three, material);
  const lines = new LineSegments2(geometry, material);
  const ghostGeometry = shareProgramGeometry(LineSegmentsGeometry, geometry);
  const ghostMaterial = new LineMaterial({ linewidth: 1, transparent: true, opacity: 0.18 });
  editLineMaterial(ghostMaterial, 'test-ghost-shown', withShownMoves);
  const ghost = new LineSegments2(ghostGeometry, ghostMaterial);
  const state: GhostTailState = {
    index: { value: 1 },
    point: { value: new three.Vector3(15, 0, 0.5) },
    coreWidthCSS: { value: 4 },
  };
  for (const entry of [geometry, ghostGeometry]) geometries.add(entry);
  for (const entry of [material, ghostMaterial]) materials.add(entry);
  return { positions, colors, geometry, lines, trail, ghost, ghostMaterial, state };
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

function draw(
  material: LineMaterial,
  geometry: three.BufferGeometry,
  renderer = {
    getCurrentViewport: (value: three.Vector4) => value.set(0, 0, 800, 600),
    getViewport: (value: three.Vector4) => value.set(0, 0, 800, 600),
  },
) {
  const object = new three.Object3D();
  material.onBeforeRender(
    renderer as never,
    new three.Scene(),
    new three.Camera(),
    geometry,
    object,
    {} as never,
  );
}

describe('active ghost tail shader', () => {
  it('replaces only body endpoint references and preserves the actual ribbon and shown shader', () => {
    const source = scene();
    const before = compiled(source.ghostMaterial);
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const after = compiled(source.ghostMaterial);
    const main = after.vertexShader.indexOf(MAIN);
    const header = after.vertexShader.slice(0, main);
    expect(header).toContain('attribute vec3 instanceStart;');
    expect(header).not.toContain('attribute vec3 kerfdeskGhostStart;');
    expect(after.vertexShader).toContain(
      'vec4 start = modelViewMatrix * vec4( kerfdeskGhostStart, 1.0 );',
    );
    expect(after.vertexShader).toContain('instanceColorStart');
    expect(after.vertexShader).toContain('instanceShown < 0.5');
    const beforeBody = before.vertexShader.slice(before.vertexShader.indexOf(MAIN) + MAIN.length);
    expect(
      after.vertexShader.endsWith(beforeBody.replace(/\binstanceStart\b/g, 'kerfdeskGhostStart')),
    ).toBe(true);
    const beforeFragmentBody = before.fragmentShader.slice(
      before.fragmentShader.indexOf(MAIN) + MAIN.length,
    );
    expect(after.fragmentShader.endsWith(beforeFragmentBody)).toBe(true);
    expect(after.fragmentShader).not.toContain('gl_FragDepth');
  });

  it('leaves helpers before main and similarly named identifiers under their original names', () => {
    const source = scene();
    source.ghostMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute vec3 instanceStart;
attribute vec3 instanceEnd;
vec3 originalStart() { return instanceStart; }
void main() {
  vec3 instanceStartSuffix = instanceStart;
  gl_Position = vec4( instanceStart + instanceStartSuffix + instanceEnd, 1.0 );
}`;
    };
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const after = compiled(source.ghostMaterial).vertexShader;
    expect(after).toContain('vec3 originalStart() { return instanceStart; }');
    expect(after).toContain('vec3 instanceStartSuffix = kerfdeskGhostStart;');
    expect(after).toContain('kerfdeskGhostStart + instanceStartSuffix + instanceEnd');
  });

  it('suppresses only a selected exact zero tail before normalising its projected direction', () => {
    const source = scene();
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const shader = compiled(source.ghostMaterial).vertexShader;
    const main = shader.indexOf(MAIN);
    const extrusion = shader.indexOf('float aspect = resolution.x / resolution.y;');
    const first = shader.slice(main + MAIN.length, extrusion);
    expect(first).toMatch(
      /vec3 kerfdeskGhostStart = instanceStart;[\s\S]*kerfdeskGhostTailEnabled > 0\.5/,
    );
    expect(first).toContain('float( gl_InstanceID ) == kerfdeskGhostActiveIndex');
    expect(first).toMatch(
      /kerfdeskGhostStart = kerfdeskGhostActivePoint;[\s\S]*all\( equal\( kerfdeskGhostStart, instanceEnd \) \)/,
    );
    expect(first).toMatch(/gl_Position = vec4\( 0\.0, 0\.0, 2\.0, 1\.0 \);\s*return;/);
    expect(shader.indexOf('return;', main)).toBeLessThan(extrusion);
    expect(first).not.toContain('length(');
    expect(first).not.toContain('normalize(');
  });

  it('shares live active state without rewriting any geometry or colour buffer', () => {
    const source = scene();
    const attributes = { ...source.ghost.geometry.attributes };
    const positions = [...source.positions];
    const colors = [...source.colors];
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const first = compiled(source.ghostMaterial);
    source.state.index.value = -1;
    source.state.point.value.set(
      Math.fround(100.123456),
      Math.fround(-20.987654),
      Math.fround(0.123456),
    );
    const second = compiled(source.ghostMaterial);
    for (const shader of [first, second]) {
      expect(shader.uniforms.kerfdeskGhostActiveIndex).toBe(source.state.index);
      expect(shader.uniforms.kerfdeskGhostActivePoint).toBe(source.state.point);
      expect(shader.uniforms.kerfdeskGhostActiveIndex?.value).toBe(-1);
      expect(shader.uniforms.kerfdeskGhostActivePoint?.value).toEqual(source.state.point.value);
    }
    expect(first.uniforms.kerfdeskGhostTailEnabled).toBe(second.uniforms.kerfdeskGhostTailEnabled);
    expect(source.ghost.geometry.attributes).toEqual(attributes);
    for (const [name, attribute] of Object.entries(attributes))
      expect(source.ghost.geometry.getAttribute(name)).toBe(attribute);
    expect([...source.positions]).toEqual(positions);
    expect([...source.colors]).toEqual(colors);
  });

  it('retains an unknown shader without a main anchor', () => {
    const source = scene();
    source.ghostMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = 'void other() {}';
    };
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const shader = compiled(source.ghostMaterial);
    expect(shader.vertexShader).toBe('void other() {}');
    expect(shader.fragmentShader).toBe(source.ghostMaterial.fragmentShader);
  });
});

describe('ghost tail draw and callback composition', () => {
  it('defaults on only for the original full geometry and rejects LOD despite shared attributes', () => {
    const source = scene();
    const lod = shareProgramGeometry(LineSegmentsGeometry, source.ghost.geometry);
    geometries.add(lod);
    const previous = vi.fn();
    source.ghostMaterial.onBeforeRender = previous;
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const enabled = compiled(source.ghostMaterial).uniforms.kerfdeskGhostTailEnabled!;
    expect(enabled.value).toBe(0);
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(enabled.value).toBe(1);
    draw(source.ghostMaterial, lod);
    expect(enabled.value).toBe(0);
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(enabled.value).toBe(1);
    expect(previous).toHaveBeenCalledTimes(3);
    for (const context of previous.mock.contexts) expect(context).toBe(source.ghostMaterial);
    expect(previous.mock.calls[1]?.[3]).toBe(lod);
  });

  it('honours a live comparison switch and captures the previous cache key and callbacks', () => {
    const source = scene();
    const enabled = { value: true };
    const state = { ...source.state, enabled };
    const shown = source.ghostMaterial.onBeforeCompile;
    const previousCompile = vi.fn(function (this: LineMaterial, shader, renderer) {
      shown.call(this, shader, renderer);
    });
    const previousRender = vi.fn(() => {
      enabled.value = true;
    });
    source.ghostMaterial.onBeforeCompile = previousCompile;
    source.ghostMaterial.onBeforeRender = previousRender;
    source.ghostMaterial.customProgramCacheKey = () =>
      source.ghostMaterial.onBeforeCompile.toString();
    const key = source.ghostMaterial.customProgramCacheKey();
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, state);
    const shader = compiled(source.ghostMaterial);
    expect(previousCompile).toHaveBeenCalledOnce();
    expect(previousCompile.mock.contexts[0]).toBe(source.ghostMaterial);
    expect(source.ghostMaterial.customProgramCacheKey()).toBe(key + '-ghost-tail-core-cap');
    // A later callback change must not make the captured base key self-referential.
    const tailCompile = source.ghostMaterial.onBeforeCompile;
    source.ghostMaterial.onBeforeCompile = () => undefined;
    expect(source.ghostMaterial.customProgramCacheKey()).toBe(key + '-ghost-tail-core-cap');
    source.ghostMaterial.onBeforeCompile = tailCompile;
    enabled.value = false;
    draw(source.ghostMaterial, source.ghost.geometry);
    // The prior draw callback runs before the helper reads the admission flag.
    expect(shader.uniforms.kerfdeskGhostTailEnabled?.value).toBe(1);
    previousRender.mockImplementation(() => undefined);
    enabled.value = false;
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(shader.uniforms.kerfdeskGhostTailEnabled?.value).toBe(0);
    enabled.value = true;
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(shader.uniforms.kerfdeskGhostTailEnabled?.value).toBe(1);
    expect(previousRender).toHaveBeenCalledTimes(3);
  });

  it('keeps source class and plane predicates when depth batching clones the trimmed base ghost', () => {
    const source = scene();
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const batches = createDepthBatches({
      three,
      LineSegments2,
      lines: source.lines,
      ghost: source.ghost,
      trail: source.trail,
      colors: source.colors,
    });
    for (const material of batches.materials) materials.add(material);
    for (const index of [1, 4, 5]) {
      const material = batches.materials[index]!;
      const shader = compiled(material);
      expect(shader.uniforms.kerfdeskGhostActiveIndex).toBe(source.state.index);
      expect(shader.uniforms.kerfdeskGhostActivePoint).toBe(source.state.point);
      expect(shader.uniforms.kerfdeskGhostCoreWidthCSS).toBe(source.state.coreWidthCSS);
      expect(shader.vertexShader).toContain('attribute vec3 instanceStart;');
      expect(shader.vertexShader).toContain('modelViewMatrix * vec4( kerfdeskGhostStart, 1.0 )');
      expect(material.customProgramCacheKey()).toContain('-ghost-tail');
      expect(batches.objects[index]?.geometry).toBe(source.ghost.geometry);
      draw(material, source.ghost.geometry);
      expect(shader.uniforms.kerfdeskGhostTailEnabled?.value).toBe(1);
    }
    const constant = compiled(batches.materials[4]!);
    expect(constant.vertexShader).toContain('instanceStart.z != instanceEnd.z');
    expect(constant.vertexShader).toContain('instanceStart.z == instanceEnd.z');
    expect(constant.vertexShader).toContain('-instanceStart.z');
    expect(constant.vertexShader).not.toContain('kerfdeskGhostStart.z != instanceEnd.z');
    const ramp = compiled(batches.materials[5]!);
    expect(ramp.vertexShader).toContain('instanceStart.z == instanceEnd.z');
    expect(ramp.fragmentShader).not.toContain('gl_FragDepth');
    for (const index of [0, 2, 3])
      expect(compiled(batches.materials[index]!).vertexShader).not.toContain('kerfdeskGhostStart');
  });
});

describe('selected active core-tip protection', () => {
  it.each([
    ['DPR1', [0, 0, 800, 600], [0, 0, 800, 600], [1, 1]],
    ['DPR2', [0, 0, 1600, 1200], [0, 0, 800, 600], [2, 2]],
    ['offset', [200, 90, 800, 600], [100, 45, 400, 300], [2, 2]],
    ['target13', [17, 23, 13, 13], [0, 0, 800, 600], [13 / 800, 13 / 600]],
    ['targetXY', [20, 30, 500, 300], [0, 0, 250, 200], [2, 1.5]],
  ] as const)(
    'uses current drawing pixels and fat-line logical resolution for %s',
    (_name, physical, logical, scale) => {
      const source = scene();
      installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
      const shader = compiled(source.ghostMaterial);
      const renderer = {
        getCurrentViewport: vi.fn((value: three.Vector4) => value.fromArray(physical)),
        getViewport: vi.fn((value: three.Vector4) => value.fromArray(logical)),
        getPixelRatio: vi.fn(() => 17),
      };
      draw(source.ghostMaterial, source.ghost.geometry, renderer);
      expect(shader.uniforms.kerfdeskGhostViewport?.value).toEqual(new three.Vector4(...physical));
      expect(shader.uniforms.kerfdeskGhostCoreScale?.value).toEqual(new three.Vector2(...scale));
      expect(renderer.getCurrentViewport).toHaveBeenCalledOnce();
      expect(renderer.getViewport).toHaveBeenCalledOnce();
      expect(renderer.getPixelRatio).not.toHaveBeenCalled();
      expect(shader.uniforms.kerfdeskGhostCoreWidthCSS).toBe(source.state.coreWidthCSS);
      source.state.coreWidthCSS.value = 6.25;
      expect(shader.uniforms.kerfdeskGhostCoreWidthCSS?.value).toBe(6.25);
      const next = compiled(source.ghostMaterial);
      expect(next.uniforms.kerfdeskGhostViewport).toBe(shader.uniforms.kerfdeskGhostViewport);
      expect(next.uniforms.kerfdeskGhostCoreScale).toBe(shader.uniforms.kerfdeskGhostCoreScale);
    },
  );

  it('restricts the protected disc to the selected instance with front-facing unclipped tip projection', () => {
    const source = scene();
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const { vertexShader: vertex, fragmentShader: fragment } = compiled(source.ghostMaterial);
    const selected = vertex.indexOf('float( gl_InstanceID ) == kerfdeskGhostActiveIndex');
    expect(vertex.indexOf('vKerfdeskGhostCoreTip = vec3( 0.0 );')).toBeLessThan(selected);
    const cameraTip = vertex.indexOf(
      'vec4 cameraTip = modelViewMatrix * vec4( kerfdeskGhostActivePoint, 1.0 );',
    );
    const projected = vertex.indexOf('vec4 clipTip = projectionMatrix * cameraTip;');
    expect(cameraTip).toBeGreaterThan(selected);
    expect(projected).toBeGreaterThan(cameraTip);
    expect(vertex).toContain('clipTip.w > 0.0 && abs( clipTip.z ) <= clipTip.w');
    expect(vertex).toContain('( ndcTip * 0.5 + 0.5 ) * kerfdeskGhostViewport.zw, 1.0 );');
    expect(vertex).toContain('flat varying vec3 vKerfdeskGhostCoreTip;');
    expect(fragment).toContain('flat varying vec3 vKerfdeskGhostCoreTip;');
    expect(fragment).toContain('vKerfdeskGhostCoreTip.z > 0.5 && kerfdeskGhostCoreWidthCSS > 0.0');
    expect(fragment).toContain('all( greaterThan( kerfdeskGhostCoreScale, vec2( 0.0 ) ) )');
    // The guard excludes points behind a perspective camera or either clip plane.
    const camera = new three.PerspectiveCamera(40, 800 / 600, 0.1, 1000);
    camera.position.set(100, -100, 30);
    camera.lookAt(50, 0, -5);
    camera.updateMatrixWorld();
    const inFront = new three.Vector4(50, 0, -5, 1)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    expect(inFront.w).toBeGreaterThan(0);
    expect(Math.abs(inFront.z)).toBeLessThan(inFront.w);
    const behind = new three.Vector4(0, 0, 10, 1).applyMatrix4(camera.projectionMatrix);
    expect(behind.w).toBeLessThan(0);
    for (const distance of [0.01, 2000]) {
      const clipped = new three.Vector4(0, 0, -distance, 1).applyMatrix4(camera.projectionMatrix);
      expect(Math.abs(clipped.z)).toBeGreaterThan(clipped.w);
    }
  });

  it('protects the failed DPR2 interior samples and pixel-edge coverage while keeping the distant tail', () => {
    const source = scene();
    source.state.point.value.set(50, 0, -5);
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const shader = compiled(source.ghostMaterial);
    const fragment = shader.fragmentShader;
    expect(fragment).toContain('vec2 pixelMin = floor( gl_FragCoord.xy );');
    expect(fragment).toContain(
      'clamp( vKerfdeskGhostCoreTip.xy, pixelMin, pixelMin + vec2( 1.0 ) )',
    );
    expect(fragment).toContain('( vKerfdeskGhostCoreTip.xy - nearest ) / kerfdeskGhostCoreScale');
    expect(fragment).toContain('float radius = kerfdeskGhostCoreWidthCSS * 0.5;');
    expect(fragment).toContain('if ( dot( delta, delta ) <= radius * radius ) discard;');
    expect(fragment.indexOf('discard;', fragment.indexOf(MAIN))).toBeLessThan(
      fragment.indexOf('float alpha = opacity;'),
    );
    // Independent projection and corner-envelope controls for the preserved GPU failure.
    const camera = new three.PerspectiveCamera(40, 800 / 600, 0.1, 1000);
    camera.position.set(100, -100, 30);
    camera.lookAt(50, 0, -5);
    camera.updateMatrixWorld();
    const ndc = source.state.point.value.clone().project(camera);
    const tip = new three.Vector2((ndc.x * 0.5 + 0.5) * 1600, (ndc.y * 0.5 + 0.5) * 1200);
    expect(tip.x).toBeCloseTo(800, 10);
    expect(tip.y).toBeCloseTo(600, 10);
    const radius = source.state.coreWidthCSS.value;
    for (const [x, y] of [
      [801, 600],
      [799, 599],
      [800, 599],
    ])
      for (const [dx, dy] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ])
        expect(new three.Vector2(x! + dx!, y! + dy!).distanceTo(tip)).toBeLessThan(radius);
    // A centre-only test would miss this tangent pixel; its square touches the disc.
    expect(new three.Vector2(804.5, 600.5).distanceTo(tip)).toBeGreaterThan(radius);
    expect(new three.Vector2(804, 600).distanceTo(tip)).toBeCloseTo(radius, 10);
    // Every point in the next square lies beyond the protected cap.
    expect(new three.Vector2(805, 600).distanceTo(tip)).toBeGreaterThan(radius);
    expect(fragment).not.toContain('gl_FragDepth');
  });

  it('clears cap scale when LOD or the comparison switch opts out and restores it on the full draw', () => {
    const source = scene();
    const enabled = { value: true };
    const state = { ...source.state, enabled };
    const lod = shareProgramGeometry(LineSegmentsGeometry, source.ghost.geometry);
    geometries.add(lod);
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, state);
    const shader = compiled(source.ghostMaterial);
    const scale = shader.uniforms.kerfdeskGhostCoreScale?.value as three.Vector2;
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(scale.toArray()).toEqual([1, 1]);
    draw(source.ghostMaterial, lod);
    expect(scale.toArray()).toEqual([0, 0]);
    expect(shader.uniforms.kerfdeskGhostTailEnabled?.value).toBe(0);
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(scale.toArray()).toEqual([1, 1]);
    enabled.value = false;
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(scale.toArray()).toEqual([0, 0]);
    enabled.value = true;
    draw(source.ghostMaterial, source.ghost.geometry);
    expect(scale.toArray()).toEqual([1, 1]);
  });

  it('does not inject unmatched varyings when only the vertex main anchor is present', () => {
    const source = scene();
    source.ghostMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = 'void other() {}';
    };
    installGhostTail(three, source.ghostMaterial, source.ghost.geometry, source.state);
    const shader = compiled(source.ghostMaterial);
    expect(shader.vertexShader).toBe(source.ghostMaterial.vertexShader);
    expect(shader.fragmentShader).toBe('void other() {}');
  });
});
