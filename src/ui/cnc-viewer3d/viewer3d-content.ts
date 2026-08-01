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
import type { ChiploadMaterial } from '../../core/cnc';
import type { ReliefSurfaceMesh } from '../../core/relief';
import type { ToolProfilePoint } from '../../core/sim';
import { pointAtArcLength, type Move3d } from '../../core/toolpath3d';
import { materialAppearance, type MaterialAppearance } from '../theme/material-appearance';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { displayModeFlags, type Viewer3DDisplayMode } from './viewer3d-display-mode';
import { localFromScene } from './viewer3d-picking';
import { buildStageFurniture } from './viewer3d-stage';
import { buildToolMesh, type ToolMeshHandle } from './viewer3d-tool';
import { buildToolpathLines, type ToolpathLinesHandle } from './viewer3d-toolpath';

type ThreeModule = typeof ThreeNamespace;

// Either surface builder's output. The smooth relief mesh omits `normals` and
// lets three average them, which is right for an organic carve; the stepped
// CNC mesh authors them so pocket walls stay vertical (ADR-261).
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
  // Where the cutter sits, in the same scene frame as `moves`. Driven by the
  // scrubber, so the tool moves along the path instead of parking somewhere
  // arbitrary — which is the only way it reads as information and not debris.
  readonly toolAtMm?: { readonly x: number; readonly y: number; readonly z: number };
};

export type ViewerContentInput = {
  readonly mesh: ViewerSurfaceMesh;
  readonly stockThicknessMm: number;
  readonly toolpath?: ViewerToolpathOverlay;
  // The job's stock material. Absent = "Custom", which keeps the original
  // wood palette so nothing changes for an unconfigured job.
  readonly materialKey?: ChiploadMaterial;
};

// Guards the depth ramp against a zero stock thickness, which would divide by
// zero and paint the whole surface one colour.
const MIN_DEPTH_SPAN_MM = 0.5;

export type ViewerContentHandle = {
  readonly object: Object3D;
  readonly dispose: () => void;
  // Moves the cutter and reveals the path up to an arc-length position, or
  // shows the finished job when given null. Deliberately NOT a rebuild: the
  // scrubber ticks continuously, and re-stamping a 300x300 surface per tick
  // would make playback unusable.
  readonly setScrubMm: (atMm: number | null) => void;
  /** Shows or hides the surface and the route per the display mode. */
  readonly setDisplayMode: (mode: Viewer3DDisplayMode) => void;
  // The machined surface alone. Raycasting the whole group would also hit the
  // grid, the stock outline and the toolpath quads, and report their depth.
  readonly surface: Object3D;
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
  const { mesh, stockThicknessMm, toolpath, materialKey } = input;
  const appearance = materialAppearance(materialKey);
  const group = new three.Group();
  group.name = 'content';
  const disposers: Array<() => void> = [];

  const geometry = buildSurfaceGeometry(three, mesh);
  // Shade by depth so carved areas read darker. A single flat tint leaves a
  // pocket floor almost the same value as the stock top, so the shape has to
  // be inferred from lighting alone — which is why it was hard to see.
  applyDepthColors(three, geometry, stockThicknessMm, appearance);
  const surfaceMaterial = new three.MeshStandardMaterial({
    vertexColors: true,
    side: three.DoubleSide,
    flatShading: false,
    // Per material: timber is matte and specular highlights read as features,
    // whereas acrylic without gloss and aluminium without metalness both just
    // look like painted wood.
    roughness: appearance.roughness,
    metalness: appearance.metalness,
  });
  const surfaceMesh = new three.Mesh(geometry, surfaceMaterial);
  group.add(surfaceMesh);
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
  // keeps the path registered to the cut it describes (ADR-261 §2).
  let lines: ToolpathLinesHandle | null = null;
  if (toolpath !== undefined) {
    lines = await buildToolpathLines(three, toolpath.moves, toolpath.originMm);
    lines.object.scale.set(1, -1, 1);
    lines.object.position.set(-mesh.widthMm / 2, mesh.heightMm / 2, 0);
    group.add(lines.object);
    disposers.push(lines.dispose);
  }

  // The cutter, drawn only when the scrubber says where it is. A tool parked
  // at a fixed position reads as debris stuck in the workpiece rather than as
  // information — confirmed by the maintainer on first sight — so it appears
  // only once playback can actually move it along the path. Built ONCE and
  // repositioned; a LatheGeometry rebuild per scrub tick would be waste.
  let tool: ToolMeshHandle | null = null;
  if (toolpath?.toolAtMm !== undefined) {
    tool = buildToolAt(three, mesh, toolpath, toolpath.toolAtMm);
    if (tool !== null) {
      group.add(tool.object);
      disposers.push(tool.dispose);
    }
  }

  return {
    object: group,
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
    surface: surfaceMesh,
    setDisplayMode: (mode) => {
      const flags = displayModeFlags(mode);
      surfaceMesh.visible = flags.isSurfaceVisible;
      surfaceMaterial.opacity = flags.surfaceOpacity;
      // transparent must be toggled with the opacity, not left on: an opaque
      // material flagged transparent is sorted per-object and z-fights the
      // stock outline at grazing angles.
      surfaceMaterial.transparent = flags.surfaceOpacity < 1;
      surfaceMaterial.needsUpdate = true;
      if (lines !== null) lines.object.visible = flags.isToolpathVisible;
      // The cutter belongs to the route, not the result: hiding the path and
      // leaving the bit floating over the part reads as a modelling error.
      if (tool !== null) tool.object.visible = flags.isToolpathVisible;
    },
    setScrubMm: (atMm) => {
      lines?.setRevealMm(atMm);
      if (tool === null || toolpath === undefined) return;
      const at = atMm === null ? null : pointAtArcLength(toolpath.moves, atMm);
      if (at === null) return;
      const local = toolLocalPosition(mesh, toolpath, at);
      tool.object.position.set(local.x, local.y, local.z);
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

// Ramps the surface from light at the stock top to dark at full depth.
// Normalised over STOCK THICKNESS, not the deepest cut, so depth reads as an
// absolute fraction of the material — a 1 mm scratch must not look like a
// through-pocket. Colours go through THREE.Color so ColorManagement does the
// sRGB -> linear conversion; raw 0..1 triples render too bright.
function applyDepthColors(
  three: ThreeModule,
  geometry: BufferGeometry,
  stockThicknessMm: number,
  appearance: MaterialAppearance,
): void {
  const position = geometry.getAttribute('position');
  const shallow = new three.Color(appearance.shallow);
  const deep = new three.Color(appearance.deep);
  const span = Math.max(stockThicknessMm, MIN_DEPTH_SPAN_MM);
  const colors = new Float32Array(position.count * 3);
  const mixed = new three.Color();
  for (let index = 0; index < position.count; index += 1) {
    // Z is 0 at the stock top and negative into the material.
    const depth = Math.min(1, Math.max(0, -position.getZ(index) / span));
    mixed.copy(shallow).lerp(deep, depth);
    colors[index * 3] = mixed.r;
    colors[index * 3 + 1] = mixed.g;
    colors[index * 3 + 2] = mixed.b;
  }
  geometry.setAttribute('color', new three.BufferAttribute(colors, 3));
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
): ToolMeshHandle | null {
  if (toolpath.toolProfile === undefined) return null;
  return buildToolMesh(three, toolpath.toolProfile, toolLocalPosition(mesh, toolpath, atMm));
}

// Shared by the initial placement and every scrub update so the two cannot
// drift, and shared with the hover readout's inverse so a frame change has one
// place to happen.
function toolLocalPosition(
  mesh: ViewerSurfaceMesh,
  toolpath: ViewerToolpathOverlay,
  atMm: { readonly x: number; readonly y: number; readonly z: number },
): { readonly x: number; readonly y: number; readonly z: number } {
  return localFromScene(atMm, toolpath.originMm, mesh);
}
