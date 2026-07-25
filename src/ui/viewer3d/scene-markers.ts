// The two head markers (ADR-255 stage 9d).
//
// One is the SIMULATED playback head; the other is where the machine
// actually reports being. They are deliberately different colours and the
// live one draws on top of all geometry — confusing a simulation for a live
// machine position would be dangerous.

import type * as ThreeNamespace from 'three';
import type { Viewer3dSegmentsInput } from './segment-buckets';

const MARKER_RADIUS_FRACTION = 0.012;
const MARKER_MIN_RADIUS_MM = 0.4;
const MARKER_COLOR = 0xffffff;
/** A colour used nowhere else in the scene, so the live head can never be
 * mistaken for a toolpath move or the playback marker. */
const LIVE_MARKER_COLOR = 0x00e5ff;
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
  let span = 0;
  for (let index = 0; index < segments.segmentCount * 6; index += 3) {
    span = Math.max(span, Math.abs(segments.positions[index] ?? 0));
  }
  const radius = Math.max(MARKER_MIN_RADIUS_MM, span * MARKER_RADIUS_FRACTION);
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
