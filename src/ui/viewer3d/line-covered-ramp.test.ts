import * as three from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
} from './line-depth-plane-geometry';
import { sourceScene as createSourceScene } from './line-covered-ramp.test-fixture';

const sources = new Set<ReturnType<typeof createSourceScene>>();

afterEach(() => {
  for (const source of sources) source.dispose();
  sources.clear();
});

function sourceScene() {
  const source = createSourceScene();
  sources.add(source);
  return source;
}

describe('resolved nonvertical ramp coverage opt-in', () => {
  it('keeps original draws, counts, shared descriptors and source arrays without a split', () => {
    const source = sourceScene();
    const bytes = source.positions.slice();
    expect(source.read()).toBe(1);
    expect(source.batches.split).toBe(false);
    expect(source.batches.objects).toEqual([source.lines, source.ghost]);
    expect(source.batches.materials).toEqual([source.lines.material, source.ghost.material]);
    expect(source.lines.geometry.instanceCount).toBe(3);
    expect(source.ghost.geometry.instanceCount).toBe(5);
    for (const name of [
      'instanceStart',
      'instanceEnd',
      'instanceShown',
      DEPTH_PLANE_ATTRIBUTE,
      DEPTH_PLANE_OFFSET_ATTRIBUTE,
      DEPTH_PLANE_ORIGIN_ATTRIBUTE,
    ]) {
      expect(source.ghost.geometry.getAttribute(name)).toBe(
        source.lines.geometry.getAttribute(name),
      );
    }
    expect(source.positions).toEqual(bytes);
    expect(source.shader.uniforms.kerfdeskCoveredStart).toBe(source.trail.trailStart);
    expect(source.shader.uniforms.kerfdeskCoveredEnd).toBe(source.trail.trailEnd);
    expect(source.ghost.material.customProgramCacheKey()).toContain('-covered-ghost-ramp-v1');
  });

  it('excludes vertical, active, future, pre-trail and unresolved edge-on rows in emitted predicates', () => {
    const { shader } = sourceScene();
    const at = shader.vertexShader.indexOf('kerfdeskCoveredRampEnabled > 0.5');
    expect(at).toBeGreaterThan(shader.vertexShader.lastIndexOf('vKerfdeskXYPlane ='));
    const ramp = shader.vertexShader.slice(at);
    expect(ramp).toContain('instanceStart.z != instanceEnd.z');
    expect(ramp).toContain('kerfdeskDepthPlane.z == 1.0');
    expect(ramp).toContain('abs( vKerfdeskXYPlane.z ) > 1e-8');
    expect(ramp).toContain('float( gl_InstanceID ) >= kerfdeskCoveredStart');
    expect(ramp).toContain('float( gl_InstanceID ) < kerfdeskCoveredEnd');
    expect(shader.fragmentShader).toContain('gl_FragDepth = gl_FragCoord.z');
    expect(shader.fragmentShader).toContain('gl_FragDepth = planeDepth');
  });

  it('retains the old flat guard when clipping or coverage makes the new ramp guard ineligible', () => {
    const source = sourceScene();
    source.lines.material.clippingPlanes = [new three.Plane()];
    expect(source.read()).toBe(0);
    expect(source.shader.uniforms.kerfdeskCoveredEnabled?.value).toBe(1);
    source.lines.material.clippingPlanes = [];
    source.lines.material.alphaToCoverage = true;
    expect(source.read()).toBe(0);
    expect(source.shader.uniforms.kerfdeskCoveredEnabled?.value).toBe(1);
    source.lines.material.alphaToCoverage = false;
    expect(source.read()).toBe(1);
  });

  it('allows the real Inspector local-clipping enable flag with no active planes', () => {
    const source = sourceScene();
    source.renderer.localClippingEnabled = true;
    expect(source.read()).toBe(1);
  });

  it('derives first and moving draws from the shared current camera/viewport, not cached solid state', () => {
    const source = sourceScene();
    const camera = new three.PerspectiveCamera(40, 4 / 3, 0.1, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(-100, 120, 100);
    camera.lookAt(20, 0, 2);
    camera.updateMatrixWorld();
    source.lines.modelViewMatrix.makeTranslation(999, -888, 777);
    source.lines.normalMatrix.set(2, 0, 0, 0, 3, 0, 0, 0, 4);
    source.lines.material.resolution.set(1, 1);
    expect(source.read(camera)).toBe(1);
    expect(source.ghost.modelViewMatrix.equals(source.lines.modelViewMatrix)).toBe(false);
    expect(source.ghost.normalMatrix.equals(source.lines.normalMatrix)).toBe(false);
    expect(source.ghost.material.resolution.toArray()).toEqual([800, 600]);
    camera.position.x += 20;
    camera.zoom = 1.5;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    source.renderer.viewport.set(13, 17, 400, 300);
    expect(source.read(camera)).toBe(1);
    expect(source.ghost.material.resolution.toArray()).toEqual([400, 300]);
    expect(source.shader.uniforms.kerfdeskXYPlaneMatrix?.value).toEqual(
      camera.projectionMatrix.clone().invert().transpose(),
    );
  });

  const changes: readonly [string, (source: ReturnType<typeof sourceScene>) => void][] = [
    [
      'solid depth write',
      (s) => {
        s.lines.material.depthWrite = false;
      },
    ],
    [
      'solid depth test',
      (s) => {
        s.lines.material.depthTest = false;
      },
    ],
    [
      'solid LEQUAL',
      (s) => {
        s.lines.material.depthFunc = three.LessDepth;
      },
    ],
    [
      'solid opacity',
      (s) => {
        s.lines.material.opacity = 0.9;
      },
    ],
    [
      'solid transparent',
      (s) => {
        s.lines.material.transparent = true;
      },
    ],
    [
      'solid width',
      (s) => {
        s.lines.material.linewidth = 0.5;
      },
    ],
    [
      'solid hidden',
      (s) => {
        s.lines.visible = false;
      },
    ],
    [
      'solid material hidden',
      (s) => {
        s.lines.material.visible = false;
      },
    ],
    [
      'solid color write',
      (s) => {
        s.lines.material.colorWrite = false;
      },
    ],
    [
      'completed count below trail end',
      (s) => {
        s.lines.geometry.instanceCount = 2;
      },
    ],
    [
      'alpha coverage',
      (s) => {
        s.lines.material.alphaToCoverage = true;
      },
    ],
    [
      'alpha test',
      (s) => {
        s.lines.material.alphaTest = 0.1;
      },
    ],
    [
      'alpha hash',
      (s) => {
        s.lines.material.alphaHash = true;
      },
    ],
    [
      'dashes',
      (s) => {
        s.lines.material.dashed = true;
      },
    ],
    [
      'world width',
      (s) => {
        s.lines.material.worldUnits = true;
      },
    ],
    [
      'polygon bias',
      (s) => {
        s.lines.material.polygonOffset = true;
      },
    ],
    [
      'stencil',
      (s) => {
        s.lines.material.stencilWrite = true;
      },
    ],
    [
      'ghost LESS',
      (s) => {
        s.ghost.material.depthFunc = three.LessEqualDepth;
      },
    ],
    [
      'ghost depth write',
      (s) => {
        s.ghost.material.depthWrite = true;
      },
    ],
    [
      'ghost depth test',
      (s) => {
        s.ghost.material.depthTest = false;
      },
    ],
    [
      'ghost coverage',
      (s) => {
        s.ghost.material.alphaToCoverage = true;
      },
    ],
    [
      'ghost alpha test',
      (s) => {
        s.ghost.material.alphaTest = 0.1;
      },
    ],
    [
      'ghost dashes',
      (s) => {
        s.ghost.material.dashed = true;
      },
    ],
    [
      'ghost material hidden',
      (s) => {
        s.ghost.material.visible = false;
      },
    ],
    [
      'global clipping',
      (s) => {
        s.renderer.clippingPlanes = [new three.Plane()];
      },
    ],
    [
      'solid clip planes',
      (s) => {
        s.lines.material.clippingPlanes = [new three.Plane()];
      },
    ],
    [
      'ghost clip planes',
      (s) => {
        s.ghost.material.clippingPlanes = [new three.Plane()];
      },
    ],
    [
      'world transform',
      (s) => {
        s.ghost.matrixWorld.makeTranslation(0, 1, 0);
      },
    ],
    [
      'solid object hook',
      (s) => {
        s.lines.onBeforeRender = () => undefined;
      },
    ],
    [
      'ghost object hook',
      (s) => {
        s.ghost.onBeforeRender = () => undefined;
      },
    ],
    [
      'layer mask',
      (s) => {
        s.ghost.layers.mask = 2;
      },
    ],
    [
      'parent',
      (s) => {
        new three.Group().add(s.ghost);
      },
    ],
    [
      'frustum culling',
      (s) => {
        s.ghost.frustumCulled = !s.lines.frustumCulled;
      },
    ],
    [
      'side',
      (s) => {
        s.ghost.material.side = three.DoubleSide;
      },
    ],
    [
      'bounds',
      (s) => {
        s.ghost.geometry.boundingSphere!.center.x += 1;
      },
    ],
    [
      'template upload',
      (s) => {
        s.ghost.geometry.getAttribute('uv').needsUpdate = true;
      },
    ],
  ];
  it.each(changes)('keeps ramp ghosts when %s breaks the coverage proof', (_name, change) => {
    const source = sourceScene();
    expect(source.read()).toBe(1);
    change(source);
    expect(source.read()).toBe(0);
  });

  it.each([
    'instanceStart',
    'instanceShown',
    DEPTH_PLANE_ATTRIBUTE,
    DEPTH_PLANE_OFFSET_ATTRIBUTE,
    DEPTH_PLANE_ORIGIN_ATTRIBUTE,
  ])('rejects replacing even both shared %s aliases after construction', (name) => {
    const source = sourceScene();
    const replacement = source.lines.geometry.getAttribute(name).clone();
    source.lines.geometry.setAttribute(name, replacement);
    source.ghost.geometry.setAttribute(name, replacement);
    expect(source.read()).toBe(0);
  });

  it('rejects either LOD geometry and restores the original full pair', () => {
    const source = sourceScene();
    const fullSolid = source.lines.geometry;
    const fullGhost = source.ghost.geometry;
    const lod = new LineSegmentsGeometry().setPositions(new Float32Array([0, 0, 0, 40, 0, 4]));
    source.retainGeometry(lod);
    source.lines.geometry = lod;
    expect(source.read()).toBe(0);
    source.lines.geometry = fullSolid;
    source.ghost.geometry = lod;
    expect(source.read()).toBe(0);
    source.ghost.geometry = fullGhost;
    expect(source.read()).toBe(1);
  });

  it('evaluates the ramp guard after the parent ghost draw callback', () => {
    const source = sourceScene();
    const previous = source.ghost.material.onBeforeRender;
    source.ghost.material.onBeforeRender = function (...args) {
      source.lines.material.clippingPlanes = [new three.Plane()];
      previous.call(this, ...args);
    };
    expect(source.read()).toBe(0);
  });
});

describe('hard screen capsule coverage premise', () => {
  it.each([1, 2])('contains every sampled body/cap point at DPR %s', (dpr) => {
    const start = new three.Vector2(10, 10).multiplyScalar(dpr);
    const end = new three.Vector2(40, 50).multiplyScalar(dpr);
    const direction = end.clone().sub(start).normalize();
    const normal = new three.Vector2(-direction.y, direction.x);
    const ghostRadius = 0.5 * dpr;
    const completedRadius = 1.25 * dpr;
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      for (const side of [-1, 1]) {
        const point = start
          .clone()
          .lerp(end, t)
          .addScaledVector(normal, side * ghostRadius);
        const along = point.clone().sub(start).dot(direction);
        const closest = start
          .clone()
          .addScaledVector(direction, Math.max(0, Math.min(end.distanceTo(start), along)));
        expect(point.distanceTo(closest)).toBeLessThan(completedRadius);
      }
    }
    for (const endpoint of [start, end]) {
      for (const axis of [
        new three.Vector2(1, 0),
        new three.Vector2(0, 1),
        new three.Vector2(-1, 0),
        new three.Vector2(0, -1),
      ]) {
        expect(
          endpoint.clone().addScaledVector(axis, ghostRadius).distanceTo(endpoint),
        ).toBeLessThan(completedRadius);
      }
    }
  });
});
