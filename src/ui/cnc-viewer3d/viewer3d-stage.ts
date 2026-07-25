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
 * @returns A group of inert scenery plus its disposer.
 */
export function buildStageFurniture(
  three: ThreeModule,
  extents: Extents,
  stockThicknessMm: number,
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

  const axes = new three.AxesHelper(span * AXIS_LENGTH_FRACTION);
  // Anchored at the stock's min-XY corner at the stock top: that is the corner
  // depths are measured down from, so it is the one worth marking.
  axes.position.set(-extents.widthMm / 2, -extents.heightMm / 2, 0);
  group.add(axes);
  disposers.push(() => {
    axes.geometry.dispose();
    // three types Object3D.material as one material OR an array; AxesHelper
    // uses a single one, but the type does not narrow, so handle both rather
    // than assert and risk leaking if that ever changes.
    for (const material of Array.isArray(axes.material) ? axes.material : [axes.material]) {
      material.dispose();
    }
  });

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}
