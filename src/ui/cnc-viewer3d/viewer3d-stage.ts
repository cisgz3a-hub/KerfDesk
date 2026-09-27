// buildStageFurniture — the orientation vocabulary around the part.
//
// A carve floating in empty space gives the eye nothing to judge scale or
// direction against. Two cheap additions fix that: a two-density grid under
// the stock for scale, and an axis triad so X/Y/Z are unambiguous.
//
// All of it is inert scenery — never picked, never occluding the work, and
// carrying no state (ADR-261 §3).
//
// Everything is built in the viewport's shared local frame: the stock spans
// [-w/2, +w/2] x [-h/2, +h/2] with Z=0 at the stock top and the stock bottom
// at -thickness.

import type * as ThreeNamespace from 'three';
import type { Object3D } from 'three';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import type { ViewerWorkAxes } from './viewer3d-work-axes';

type ThreeModule = typeof ThreeNamespace;

export type StageFurnitureHandle = {
  readonly object: Object3D;
  readonly dispose: () => void;
};

type Extents = {
  readonly widthMm: number;
  readonly heightMm: number;
};

// How far the grid reaches past the stock, as a fraction of the larger extent.
const GRID_MARGIN_FRACTION = 0.35;
// Target divisions for the fine grid; the coarse grid is this many times bigger.
const FINE_DIVISIONS = 40;
const COARSE_FACTOR = 5;
// The triad's arms, as a fraction of the larger stock extent.
const AXIS_LENGTH_FRACTION = 0.18;
// The grid sits a hair below the stock bottom so the two never z-fight.
const GRID_DROP_MM = 0.2;

/**
 * Builds the grid and origin triad around the stock.
 *
 * @param three The dynamically-imported three module.
 * @param extents Stock extents in mm, as used for the surface mesh.
 * @param stockThicknessMm Stock thickness, so the grid sits under the part.
 * @param workAxes Work zero in this frame; null means unavailable. Other
 *   surface viewers may omit it to retain their existing stock-corner marker.
 * @returns A group of inert scenery plus its disposer.
 */
export function buildStageFurniture(
  three: ThreeModule,
  extents: Extents,
  stockThicknessMm: number,
  workAxes?: ViewerWorkAxes | null,
): StageFurnitureHandle {
  const group = new three.Group();
  group.name = 'stage';
  const disposers: Array<() => void> = [];

  const span = Math.max(extents.widthMm, extents.heightMm);
  const gridSize = span * (1 + GRID_MARGIN_FRACTION * 2);
  const floorZ = -stockThicknessMm - GRID_DROP_MM;

  const fine = new three.GridHelper(
    gridSize,
    FINE_DIVISIONS,
    viewer3dTheme.stage.gridMinor,
    viewer3dTheme.stage.gridMinor,
  );
  const coarse = new three.GridHelper(
    gridSize,
    Math.max(1, Math.round(FINE_DIVISIONS / COARSE_FACTOR)),
    viewer3dTheme.stage.gridMajor,
    viewer3dTheme.stage.gridMajor,
  );
  for (const grid of [fine, coarse]) {
    // GridHelper is built in the XZ plane; this viewport is Z-up, so it has to
    // be stood upright or it slices through the part edge-on.
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, floorZ);
    grid.material.transparent = true;
    grid.material.opacity = viewer3dTheme.stage.gridOpacity;
    // Scenery must never occlude the work it is there to contextualise.
    grid.material.depthWrite = false;
    group.add(grid);
    disposers.push(() => {
      grid.geometry.dispose();
      grid.material.dispose();
    });
  }

  if (workAxes !== null) {
    const axes = new three.AxesHelper(span * AXIS_LENGTH_FRACTION);
    const origin = workAxes?.originMm ?? {
      x: -extents.widthMm / 2,
      y: -extents.heightMm / 2,
      z: 0,
    };
    axes.name = workAxes === undefined ? 'stock-corner-axes' : 'work-zero-axes';
    axes.position.set(origin.x, origin.y, origin.z);
    axes.scale.set(workAxes?.xDirection ?? 1, workAxes?.yDirection ?? 1, 1);
    group.add(axes);
    disposers.push(() => {
      axes.geometry.dispose();
      // AxesHelper currently has one material; retain array-safe disposal.
      for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) {
        material.dispose();
      }
    });
  }

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}
