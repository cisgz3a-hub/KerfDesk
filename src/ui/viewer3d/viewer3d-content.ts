// buildViewerContent — everything in the viewport that depends on the job.
//
// Split out from the scene so the two have different lifetimes. The renderer,
// camera, controls and lights are built once and live as long as the pane;
// this group is thrown away and rebuilt whenever the design changes. That is
// what stops the operator's orbit resetting on every keystroke, which is what
// happened when the whole scene was torn down per edit.
//
// One group, one disposer: every geometry and material created here is freed
// together, so a rebuild cannot leak.

import type * as ThreeNamespace from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { ReliefSurfaceMesh } from '../../core/relief';
import type { ToolProfilePoint } from '../../core/sim';
import type { Move3d } from '../../core/toolpath3d';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { buildStageFurniture } from './viewer3d-stage';
import { buildToolMesh } from './viewer3d-tool';
import { buildToolpathLines } from './viewer3d-toolpath';

type ThreeModule = typeof ThreeNamespace;

// Either surface builder's output. The smooth relief mesh omits `normals` and
// lets three average them, which is right for an organic carve; the stepped
// CNC mesh authors them so pocket walls stay vertical (ADR-254).
export type ViewerSurfaceMesh = ReliefSurfaceMesh & {
  readonly normals?: Float32Array;
};

// The toolpath to overlay, in the SAME scene frame the removal grid was
// stamped from, plus that grid's scene-space min corner.
export type ViewerToolpathOverlay = {
  readonly moves: ReadonlyArray<Move3d>;
  readonly originMm: { readonly x: number; readonly y: number };
  // Omitted for jobs with no CNC tool; the path still draws without a cutter.
  readonly toolProfile?: ReadonlyArray<ToolProfilePoint>;
};

export type ViewerContentInput = {
  readonly mesh: ViewerSurfaceMesh;
  readonly stockThicknessMm: number;
  readonly toolpath?: ViewerToolpathOverlay;
};

export type ViewerContentHandle = {
  readonly object: Object3D;
  readonly dispose: () => void;
};

/**
 * Builds the job-dependent contents of the viewport as one disposable group.
 *
 * @param three The dynamically-imported three module.
 * @param input Surface mesh, stock thickness, and optional toolpath overlay.
 * @returns The group plus a disposer that frees every resource it created.
 */
export async function buildViewerContent(
  three: ThreeModule,
  input: ViewerContentInput,
): Promise<ViewerContentHandle> {
  const { mesh, stockThicknessMm, toolpath } = input;
  const group = new three.Group();
  group.name = 'content';
  const disposers: Array<() => void> = [];

  const geometry = buildSurfaceGeometry(three, mesh);
  const surfaceMaterial = new three.MeshStandardMaterial({
    color: viewer3dTheme.color.surface,
    side: three.DoubleSide,
    flatShading: false,
  });
  group.add(new three.Mesh(geometry, surfaceMaterial));
  disposers.push(() => {
    geometry.dispose();
    surfaceMaterial.dispose();
  });

  addStockOutline(three, group, mesh, stockThicknessMm, disposers);

  const stage = buildStageFurniture(three, mesh, stockThicknessMm);
  group.add(stage.object);
  disposers.push(stage.dispose);

  // The toolpath rides the SAME mirror and recentre the surface geometry is
  // baked with, applied here as an object transform. Object matrices compose
  // as T * R * S, so setting position and scale reproduces geometry.scale()
  // followed by geometry.translate() exactly. Sharing one transform is what
  // keeps the path registered to the cut it describes (ADR-254 §2).
  if (toolpath !== undefined) {
    const lines = await buildToolpathLines(three, toolpath.moves, toolpath.originMm);
    lines.object.scale.set(1, -1, 1);
    lines.object.position.set(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
    group.add(lines.object);
    disposers.push(lines.dispose);
  }

  // NOT drawn: the cutter. buildToolMesh and core/sim's toolProfile are ready
  // and tested, but a tool parked at a static position with no playback to
  // move it reads as debris stuck in the workpiece rather than as information
  // — confirmed by the maintainer on first sight. It comes back when the
  // scrubber can drive it along the path, which is where it earns its place.

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}

// Builds the carved-surface geometry in the viewport's shared frame.
function buildSurfaceGeometry(three: ThreeModule, mesh: ViewerSurfaceMesh): BufferGeometry {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(mesh.positions.slice(), 3));
  geometry.setIndex(new three.BufferAttribute(mesh.indices.slice(), 1));
  // Authored normals are attached BEFORE the mirror so three's applyMatrix4
  // carries them through its normal matrix. Attaching them afterwards would
  // leave every wall lit as though it faced the other way.
  if (mesh.normals !== undefined) {
    geometry.setAttribute('normal', new three.BufferAttribute(mesh.normals.slice(), 3));
  }
  // The heightmap's row axis points down the canvas; mirror it so text
  // reliefs read the right way round, then recenter on the origin.
  geometry.scale(1, -1, 1);
  geometry.translate(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
  // Only the smooth builder needs averaged normals. Running this over an
  // authored mesh would average the vertical walls back into 45° ramps.
  if (mesh.normals === undefined) {
    geometry.computeVertexNormals();
  }
  return geometry;
}

// Stock outline: a wire box from the stock top (z=0) down one thickness.
// BoxGeometry is only the source shape — EdgesGeometry is what the
// LineSegments actually holds, so both need disposing.
function addStockOutline(
  three: ThreeModule,
  group: Object3D,
  mesh: ViewerSurfaceMesh,
  stockThicknessMm: number,
  disposers: Array<() => void>,
): void {
  const stockGeometry = new three.BoxGeometry(mesh.widthMm, mesh.heightMm, stockThicknessMm);
  const edgeGeometry = new three.EdgesGeometry(stockGeometry);
  const edgeMaterial = new three.LineBasicMaterial({ color: viewer3dTheme.color.stockEdge });
  const edges = new three.LineSegments(edgeGeometry, edgeMaterial);
  edges.position.set(0, 0, -stockThicknessMm / 2);
  group.add(edges);
  disposers.push(() => {
    stockGeometry.dispose();
    edgeGeometry.dispose();
    edgeMaterial.dispose();
  });
}

/**
 * Places the cutter at a point on the path, in the viewport's local frame.
 *
 * Currently unused by the default view — see the note in buildViewerContent.
 * Kept because it is the piece playback needs: given a scrubbed position it
 * puts the drawn bit exactly where the simulated one is.
 *
 * @param three The dynamically-imported three module.
 * @param mesh Surface mesh, for the recentring offsets.
 * @param toolpath Overlay carrying the tool profile and the grid origin.
 * @param atMm Scene-frame point to place the tool tip at.
 * @returns The tool handle, or null when the job has no tool.
 */
export function buildToolAt(
  three: ThreeModule,
  mesh: ViewerSurfaceMesh,
  toolpath: ViewerToolpathOverlay,
  atMm: { readonly x: number; readonly y: number; readonly z: number },
): ViewerContentHandle | null {
  if (toolpath.toolProfile === undefined) return null;
  return buildToolMesh(three, toolpath.toolProfile, {
    x: atMm.x - toolpath.originMm.x - mesh.widthMm / 2,
    // Mirrored to match the surface, then recentred — the same composition the
    // surface geometry is baked with, done arithmetically because a single
    // point needs no transform node.
    y: -(atMm.y - toolpath.originMm.y) + mesh.heightMm / 2,
    z: atMm.z,
  });
}
