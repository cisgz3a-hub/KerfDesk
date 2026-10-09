// Shared ramp-test setup; each returned scene owns explicit, idempotent disposal.
import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { createDepthBatches } from './line-depth-batches';
import { editLineMaterial, withShownMoves } from './line-shader-edits';
import { addTrail, setTrail } from './line-trail';
import { createProgramGeometry, shareProgramGeometry } from './program-lines';

function sceneResources(lines: LineSegments2, ghost: LineSegments2) {
  // Keep original full resources even when a failing test leaves LOD selected.
  const geometries = new Set([lines.geometry, ghost.geometry]);
  const materials = new Set([lines.material, ghost.material]);
  return {
    retainGeometry: (geometry: LineSegmentsGeometry): void => {
      geometries.add(geometry);
    },
    dispose: (): void => {
      lines.removeFromParent();
      ghost.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      geometries.clear();
      materials.clear();
    },
  };
}

function createRenderer() {
  const logicalViewport = new three.Vector4(0, 0, 800, 600);
  return {
    clippingPlanes: [] as three.Plane[],
    localClippingEnabled: false,
    viewport: logicalViewport,
    getViewport: (value: three.Vector4) => value.copy(logicalViewport),
    getCurrentViewport: (value: three.Vector4) => value.set(0, 0, 800, 600),
  };
}

function compileGhost(
  ghost: LineSegments2,
  faint: LineMaterial,
  renderer: ReturnType<typeof createRenderer>,
) {
  const shader = {
    vertexShader: faint.vertexShader,
    fragmentShader: faint.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
  faint.onBeforeCompile(shader as never, renderer as never);
  const read = (camera: three.Camera = new three.Camera()) => {
    ghost.onBeforeRender(renderer as never);
    ghost.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, ghost.matrixWorld);
    ghost.normalMatrix.getNormalMatrix(ghost.modelViewMatrix);
    faint.onBeforeRender(
      renderer as never,
      new three.Scene(),
      camera,
      ghost.geometry,
      ghost,
      {} as never,
    );
    return shader.uniforms.kerfdeskCoveredRampEnabled?.value;
  };
  return { shader, read };
}

export function sourceScene() {
  const positions = new Float32Array([
    0, 0, 0, 10, 0, 0, 10, 0, 0, 20, 0, 1, 20, 0, 1, 20, 0, 2, 20, 0, 2, 30, 0, 3, 30, 0, 3, 40, 0,
    4,
  ]);
  const colors = new Uint16Array(20).fill(65535);
  const { geometry } = createProgramGeometry(three, LineSegmentsGeometry, positions, colors);
  geometry.instanceCount = 3;
  const solid = new LineMaterial({ linewidth: 2.5 });
  const trail = addTrail(three, solid);
  setTrail(trail, 1, 3, [0.1, 0.2, 0.3]);
  const lines = new LineSegments2(geometry, solid);
  const faint = new LineMaterial({
    linewidth: 1,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthFunc: three.LessDepth,
  });
  editLineMaterial(faint, 'ramp-ghost', withShownMoves);
  const ghost = new LineSegments2(shareProgramGeometry(LineSegmentsGeometry, geometry), faint);
  const resources = sceneResources(lines, ghost);
  try {
    const renderer = createRenderer();
    const batches = createDepthBatches({ three, LineSegments2, lines, ghost, trail, colors });
    const { shader, read } = compileGhost(ghost, faint, renderer);
    return {
      positions,
      colors,
      lines,
      ghost,
      trail,
      batches,
      renderer,
      shader,
      read,
      ...resources,
    };
  } catch (error) {
    resources.dispose();
    throw error;
  }
}
