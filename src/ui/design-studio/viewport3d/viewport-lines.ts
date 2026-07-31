// viewport-lines — turns the pure overlay buffers into fat-line drawables
// (ADR-272 Amendment 2). Lives in the viewport3d three.js home; everything it
// draws was built by the PURE viewport-overlay module, so this file is thin
// on purpose: allocate, swap, dispose.
//
// r180 facts (committed research + installed source): LineSegments2 updates
// LineMaterial.resolution itself in onBeforeRender — do not set it manually;
// worldUnits:false keeps a constant CSS-pixel width at any zoom.

import type * as ThreeNamespace from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { canvasTheme } from '../../theme/canvas-theme';
import type { ViewportOverlay } from './viewport-overlay';

type ThreeModule = typeof ThreeNamespace;

// Type-only: erased at build, so the lines addons still load in the lazy
// chunk via loadViewportLinesAddons (ADR-102 §3).
type LinesAddons = {
  readonly LineSegments2: typeof LineSegments2;
  readonly LineSegmentsGeometry: typeof LineSegmentsGeometry;
  readonly LineMaterial: typeof LineMaterial;
};

const SKETCH_LINE_WIDTH_PX = 2;
const DASH_SIZE_MM = 4;
const GAP_SIZE_MM = 2.5;
const SNAP_MARKER_MM = 2.2;

export async function loadViewportLinesAddons(): Promise<LinesAddons> {
  const [{ LineSegments2 }, { LineSegmentsGeometry }, { LineMaterial }] = await Promise.all([
    import('three/examples/jsm/lines/LineSegments2.js'),
    import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
    import('three/examples/jsm/lines/LineMaterial.js'),
  ]);
  return { LineSegments2, LineSegmentsGeometry, LineMaterial };
}

export type OverlayDrawableHandle = {
  readonly object: ThreeNamespace.Object3D;
  readonly dispose: () => void;
};

/** One group per overlay build; the caller swaps old for new and disposes. */
export function buildOverlayDrawable(
  three: ThreeModule,
  addons: LinesAddons,
  overlay: ViewportOverlay,
): OverlayDrawableHandle {
  const group = new three.Group();
  group.name = 'sketch-overlay';
  const disposers: Array<() => void> = [];

  for (const bucket of overlay.buckets) {
    const geometry = new addons.LineSegmentsGeometry();
    geometry.setPositions(bucket.positions);
    const material = new addons.LineMaterial({
      color: new three.Color(bucket.color).getHex(),
      linewidth: SKETCH_LINE_WIDTH_PX,
      worldUnits: false,
      dashed: bucket.dashed,
      ...(bucket.dashed ? { dashSize: DASH_SIZE_MM, gapSize: GAP_SIZE_MM } : {}),
    });
    const lines = new addons.LineSegments2(geometry, material);
    if (bucket.dashed) lines.computeLineDistances();
    // The sketch must stay legible over the carved surface from any angle.
    lines.renderOrder = 2;
    group.add(lines);
    disposers.push(() => {
      geometry.dispose();
      material.dispose();
    });
  }

  if (overlay.snapLocal !== null) {
    const marker = buildSnapMarker(three, overlay.snapLocal);
    group.add(marker.object);
    disposers.push(marker.dispose);
  }

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}

// A small always-on-top diamond at the captured snap point — the 3D analogue
// of the 2D canvas's snap glyph, minus the per-kind shapes (stage 1 keeps one
// glyph; the status bar still names the snap kind).
function buildSnapMarker(
  three: ThreeModule,
  at: { readonly x: number; readonly y: number; readonly z: number },
): OverlayDrawableHandle {
  const geometry = new three.CircleGeometry(SNAP_MARKER_MM, 4);
  const material = new three.MeshBasicMaterial({
    color: new three.Color(canvasTheme.selection).getHex(),
    depthTest: false,
    transparent: true,
    opacity: 0.9,
    side: three.DoubleSide,
  });
  const mesh = new three.Mesh(geometry, material);
  mesh.position.set(at.x, at.y, at.z);
  mesh.renderOrder = 3;
  return {
    object: mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
