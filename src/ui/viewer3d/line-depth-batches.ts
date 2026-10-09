// Keep every solid move in its original program-order draw. The retired
// class split remains an API flag for callers and independent viewer probes.
import type * as ThreeNamespace from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { coveredRampEligibility } from './line-covered-ramp';
import { installXYPlaneDepth, type CoveredGhost } from './line-plane-depth';
import type { TrailUniforms } from './line-trail';

export type DepthBatches = {
  readonly objects: readonly LineSegments2[];
  readonly materials: readonly LineMaterial[];
  readonly lines: LineSegments2;
  readonly ghost: LineSegments2;
  /** Class splitting is retired; originals retain source-order depth ties. */
  readonly split: boolean;
  readonly refreshColors: () => void;
  readonly sync: () => void;
};

export function createDepthBatches(args: {
  readonly three: typeof ThreeNamespace;
  readonly LineSegments2: typeof LineSegments2;
  readonly lines: LineSegments2;
  readonly ghost: LineSegments2;
  readonly trail: TrailUniforms;
  readonly colors: Uint16Array;
}): DepthBatches {
  const { three, lines, ghost, trail } = args;
  lines.name = 'toolpath-solid-depth-fallback';
  ghost.name = 'toolpath-ghost-depth-fallback';
  const fullLines = lines.geometry;
  const fullGhost = ghost.geometry;
  const covered: CoveredGhost = {
    start: trail.trailStart,
    end: trail.trailEnd,
    rampEligible: coveredRampEligibility(three, lines, ghost, trail.trailEnd),
    eligible: (geometry) =>
      geometry === fullGhost &&
      lines.geometry === fullLines &&
      !lines.material.transparent &&
      lines.material.opacity === 1 &&
      lines.material.linewidth >= ghost.material.linewidth &&
      lines.visible,
  };
  installXYPlaneDepth(three, lines.material, 'fat');
  installXYPlaneDepth(three, ghost.material, 'fat', covered);
  const keepOriginals = (): void => undefined;
  return {
    objects: [lines, ghost],
    materials: [lines.material, ghost.material],
    lines,
    ghost,
    split: false,
    refreshColors: keepOriginals,
    sync: keepOriginals,
  };
}
