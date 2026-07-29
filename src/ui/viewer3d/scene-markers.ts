// The two head markers (ADR-255 stage 9d).
//
// One is the SIMULATED playback head; the other is where the machine
// actually reports being. They are deliberately different colours and the
// live one draws on top of all geometry — confusing a simulation for a live
// machine position would be dangerous.

import type * as ThreeNamespace from 'three';
import { markerRadiusMm } from './marker-radius';
import type { Viewer3dSegmentsInput } from './segment-buckets';

export const MARKER_COLOR = 0xffffff;
/**
 * Bright red, at full red channel (maintainer request, 2026-07-29: the previous
 * cyan did not read clearly enough while watching a job run).
 *
 * It stays distinct from every other colour in the scene, but the margin is now
 * narrower than it was: `travel` is 0xcc4444, the recessive traversal red of the
 * LightBurn convention. The separation that keeps a live machine position from
 * being read as a travel move is therefore no longer colour alone — it is
 * saturation and brightness (0xff vs 0xcc red, against a far darker body), plus
 * form: this is a filled sphere at 1.6x scale with `depthTest` off, drawn over
 * all geometry, never a thin line. Do not darken it toward the travel red, and
 * do not give any other scene element a bright saturated red.
 */
export const LIVE_MARKER_COLOR = 0xff2d2d;
const LIVE_MARKER_SCALE = 1.6;

type ThreeModule = typeof ThreeNamespace;

export type MarkerMesh = ThreeNamespace.Mesh<
  ThreeNamespace.SphereGeometry,
  ThreeNamespace.MeshBasicMaterial
>;

export type SceneMarkers = {
  readonly marker: MarkerMesh;
  readonly liveMarker: MarkerMesh;
};

export function createMarkers(three: ThreeModule, scene: ThreeNamespace.Scene): SceneMarkers {
  const marker = createMarker(three, MARKER_COLOR);
  marker.visible = false;
  scene.add(marker);
  const liveMarker = createMarker(three, LIVE_MARKER_COLOR);
  liveMarker.visible = false;
  liveMarker.renderOrder = 3;
  liveMarker.material.depthTest = false;
  scene.add(liveMarker);
  return { marker, liveMarker };
}

/** Scale both markers to the job so they read at any program size. */
export function sizeMarkers(markers: SceneMarkers, segments: Viewer3dSegmentsInput): void {
  const radius = markerRadiusMm(segments);
  markers.marker.scale.setScalar(radius);
  markers.liveMarker.scale.setScalar(radius * LIVE_MARKER_SCALE);
}

export function disposeMarkers(scene: ThreeNamespace.Scene, markers: SceneMarkers): void {
  for (const mesh of [markers.marker, markers.liveMarker]) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

function createMarker(three: ThreeModule, color: number): MarkerMesh {
  return new three.Mesh(
    new three.SphereGeometry(1, 16, 12),
    new three.MeshBasicMaterial({ color }),
  );
}
