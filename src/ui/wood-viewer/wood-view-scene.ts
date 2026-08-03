// wood-view-scene — the standalone preview's renderer, ported to run inside the
// app (ADR-285). Raw WebGL2, no three.js: it owns its context, programs,
// camera and lights, which is what makes the output identical to the reference
// page rather than a re-lighting of it.
//
// Fed a RemovalGrid, so it re-renders whenever the design changes — adding a
// word simply produces a new grid.

import type { RemovalGrid } from '../../core/sim';
import { closeDepthField } from './wood-view-flatten';
import {
  linkProgram,
  lookAt,
  multiply,
  perspective,
  toHalfFloat,
  type GlProgram,
} from './wood-view-gl';
import {
  CAMERA_PRESETS,
  DEFAULT_FILL,
  DEFAULT_LIGHT_AZIMUTH_DEG,
  DEFAULT_SPECIES,
  DEFAULT_VIEW,
  GROOVE_FILLS,
  linearizeSrgb,
  WOOD_SPECIES,
} from './wood-view-palettes';
import {
  BACKGROUND_FRAGMENT_GLSL,
  BACKGROUND_VERTEX_GLSL,
  SIDE_FRAGMENT_GLSL,
  SIDE_VERTEX_GLSL,
  SURFACE_FRAGMENT_GLSL,
  SURFACE_VERTEX_GLSL,
} from './wood-view-shaders';

// The mesh must be at least as dense as the depth grid. A coarser mesh
// point-samples the heightfield, putting one vertex on a groove floor and its
// neighbour on uncut stock, which renders as thin spikes rather than a groove.
const MAX_MESH_CELLS_ACROSS = 1400;
const FOV_DEG = 32;
const LOG_CENTRE_Y_FRACTION = 0.18;
const LOG_CENTRE_Z_MM = -45;
const MIN_STOCK_THICKNESS_MM = 3;
const MAX_PIXEL_RATIO = 1.75;

export type WoodViewState = {
  readonly species: string;
  readonly fill: string;
  readonly lightAzimuthDeg: number;
  readonly az: number;
  readonly el: number;
  readonly dist: number;
};

export type WoodViewHandle = {
  readonly setHeightfield: (grid: RemovalGrid, stockThicknessMm: number) => void;
  readonly setState: (next: Partial<WoodViewState>) => void;
  readonly getState: () => WoodViewState;
  readonly render: () => void;
  readonly dispose: () => void;
};

type Mesh = { readonly vao: WebGLVertexArrayObject; readonly count: number };
type Board = { w: number; h: number; thick: number; maxDepth: number };

const HERO = CAMERA_PRESETS[DEFAULT_VIEW] ?? { az: -0.62, el: 0.62, dist: 1.3 };

export const INITIAL_WOOD_VIEW_STATE: WoodViewState = {
  species: DEFAULT_SPECIES,
  fill: DEFAULT_FILL,
  lightAzimuthDeg: DEFAULT_LIGHT_AZIMUTH_DEG,
  az: HERO.az,
  el: HERO.el,
  dist: HERO.dist,
};

function buildGrid(gl: WebGL2RenderingContext, nx: number, ny: number): Mesh | null {
  const uv = new Float32Array(nx * ny * 2);
  let k = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      uv[k] = i / (nx - 1);
      uv[k + 1] = j / (ny - 1);
      k += 2;
    }
  }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let t = 0;
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      indices[t] = a;
      indices[t + 1] = a + nx;
      indices[t + 2] = a + 1;
      indices[t + 3] = a + 1;
      indices[t + 4] = a + nx;
      indices[t + 5] = a + nx + 1;
      t += 6;
    }
  }
  const vao = gl.createVertexArray();
  if (vao === null) return null;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

function sideQuads(hw: number, hh: number, zb: number): ReadonlyArray<number[][]> {
  return [
    [
      [-hw, -hh, 0],
      [hw, -hh, 0],
      [hw, -hh, zb],
      [-hw, -hh, zb],
      [0, -1, 0],
    ],
    [
      [hw, hh, 0],
      [-hw, hh, 0],
      [-hw, hh, zb],
      [hw, hh, zb],
      [0, 1, 0],
    ],
    [
      [hw, -hh, 0],
      [hw, hh, 0],
      [hw, hh, zb],
      [hw, -hh, zb],
      [1, 0, 0],
    ],
    [
      [-hw, hh, 0],
      [-hw, -hh, 0],
      [-hw, -hh, zb],
      [-hw, hh, zb],
      [-1, 0, 0],
    ],
    [
      [-hw, -hh, zb],
      [hw, -hh, zb],
      [hw, hh, zb],
      [-hw, hh, zb],
      [0, 0, -1],
    ],
  ];
}

function buildSides(gl: WebGL2RenderingContext, w: number, h: number, thick: number): Mesh | null {
  const data: number[] = [];
  for (const quad of sideQuads(w / 2, h / 2, -thick)) {
    const n = quad[4] ?? [0, 0, 1];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const p = quad[index] ?? [0, 0, 0];
      data.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    }
  }
  const array = new Float32Array(data);
  const vao = gl.createVertexArray();
  if (vao === null) return null;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);
  return { vao, count: array.length / 6 };
}

// The grid stores z (<= 0); the texture publishes positive depth in mm.
function uploadDepth(gl: WebGL2RenderingContext, grid: RemovalGrid): WebGLTexture | null {
  const cells = grid.widthCells * grid.heightCells;
  // Flatten the groove interiors first: the stamper can leave single uncut
  // cells standing between consecutive cone stamps, which shade as spikes.
  const flattened = closeDepthField(grid.depth, grid.widthCells, grid.heightCells);
  const data = new Uint16Array(cells);
  for (let i = 0; i < cells; i += 1) {
    data[i] = toHalfFloat(Math.max(0, -(flattened[i] ?? 0)));
  }
  const texture = gl.createTexture();
  if (texture === null) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // R16F is 2 bytes per texel and the default unpack alignment is 4, so an ODD
  // cell width leaves every row 2 bytes short of the boundary and each
  // subsequent row is read shifted — which renders as regular rows of spikes.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R16F,
    grid.widthCells,
    grid.heightCells,
    0,
    gl.RED,
    gl.HALF_FLOAT,
    data,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

// Each program declares only the uniforms its stage uses, so every setter is a
// no-op when the name is absent. Guarding at the call sites instead put the
// whole uniform block over the complexity cap.
function setF(gl: WebGL2RenderingContext, p: GlProgram, name: string, v: number): void {
  const location = p.uniforms[name];
  if (location !== undefined) gl.uniform1f(location, v);
}

function setI(gl: WebGL2RenderingContext, p: GlProgram, name: string, v: number): void {
  const location = p.uniforms[name];
  if (location !== undefined) gl.uniform1i(location, v);
}

function setV2(gl: WebGL2RenderingContext, p: GlProgram, name: string, x: number, y: number): void {
  const location = p.uniforms[name];
  if (location !== undefined) gl.uniform2f(location, x, y);
}

function setV3(
  gl: WebGL2RenderingContext,
  p: GlProgram,
  name: string,
  v: Iterable<number> & ArrayLike<number>,
): void {
  const location = p.uniforms[name];
  if (location !== undefined) gl.uniform3fv(location, v);
}

function setM4(gl: WebGL2RenderingContext, p: GlProgram, name: string, m: Float32Array): void {
  const location = p.uniforms[name];
  if (location !== undefined) gl.uniformMatrix4fv(location, false, m);
}

function setWoodUniforms(
  gl: WebGL2RenderingContext,
  program: GlProgram,
  state: WoodViewState,
  board: Board,
): void {
  const species = WOOD_SPECIES[state.species] ?? WOOD_SPECIES[DEFAULT_SPECIES];
  if (species === undefined) return;
  setV3(gl, program, 'uEarly', linearizeSrgb(species.early));
  setV3(gl, program, 'uLate', linearizeSrgb(species.late));
  setF(gl, program, 'uRingFreq', species.ringFreq);
  setF(gl, program, 'uRingSharp', species.sharp);
  setF(gl, program, 'uGrainWarp', species.warp);
  setF(gl, program, 'uPore', species.pore);
  setF(gl, program, 'uFresh', species.fresh);
  setF(gl, program, 'uLogY', board.h * LOG_CENTRE_Y_FRACTION);
  setF(gl, program, 'uLogZ', LOG_CENTRE_Z_MM);
  setV2(gl, program, 'uBoard', board.w, board.h);
  setF(gl, program, 'uMaxDepth', board.maxDepth);
  setF(gl, program, 'uThick', board.thick);
}

function cameraEye(state: WoodViewState, board: Board): [number, number, number] {
  const radius = Math.max(board.w, board.h) * state.dist;
  return [
    Math.cos(state.el) * Math.sin(state.az) * radius,
    -Math.cos(state.el) * Math.cos(state.az) * radius,
    Math.sin(state.el) * radius,
  ];
}

function lightDirection(state: WoodViewState): [number, number, number] {
  const azimuth = (state.lightAzimuthDeg * Math.PI) / 180;
  const raw: [number, number, number] = [Math.cos(azimuth) * 0.62, Math.sin(azimuth) * 0.62, 0.72];
  const length = Math.hypot(raw[0], raw[1], raw[2]) || 1;
  return [raw[0] / length, raw[1] / length, raw[2] / length];
}

/**
 * Creates the ported preview on a canvas.
 *
 * @param canvas The canvas to own. The scene takes its WebGL2 context.
 * @returns The handle, or null when WebGL2 is unavailable.
 */
type Refs = {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  readonly surface: GlProgram;
  readonly side: GlProgram;
  readonly background: GlProgram;
  readonly emptyVao: WebGLVertexArrayObject | null;
  state: WoodViewState;
  grid: Mesh | null;
  gridCols: number;
  gridRows: number;
  sides: Mesh | null;
  depth: WebGLTexture | null;
  board: Board;
  texel: [number, number];
};

function drawSurface(refs: Refs, viewProj: Float32Array): void {
  const { gl, surface, state, board } = refs;
  if (refs.grid === null || refs.depth === null) return;
  const fill = GROOVE_FILLS[state.fill] ?? null;
  gl.useProgram(surface.program);
  setWoodUniforms(gl, surface, state, board);
  setM4(gl, surface, 'uViewProj', viewProj);
  setV2(gl, surface, 'uTexel', refs.texel[0], refs.texel[1]);
  setV3(gl, surface, 'uEye', cameraEye(state, board));
  setV3(gl, surface, 'uLightDir', lightDirection(state));
  setF(gl, surface, 'uPaint', fill === null ? 0 : 1);
  setV3(gl, surface, 'uPaintCol', fill === null ? [0, 0, 0] : linearizeSrgb(fill));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, refs.depth);
  setI(gl, surface, 'uHeight', 0);
  gl.bindVertexArray(refs.grid.vao);
  gl.drawElements(gl.TRIANGLES, refs.grid.count, gl.UNSIGNED_INT, 0);
}

function drawSides(refs: Refs, viewProj: Float32Array): void {
  const { gl, side, state, board } = refs;
  if (refs.sides === null) return;
  gl.useProgram(side.program);
  setWoodUniforms(gl, side, state, board);
  setM4(gl, side, 'uViewProj', viewProj);
  setV3(gl, side, 'uEye', cameraEye(state, board));
  setV3(gl, side, 'uLightDir', lightDirection(state));
  setF(gl, side, 'uPaint', 0);
  setV3(gl, side, 'uPaintCol', [0, 0, 0]);
  gl.bindVertexArray(refs.sides.vao);
  gl.drawArrays(gl.TRIANGLES, 0, refs.sides.count);
  gl.bindVertexArray(null);
}

function drawScene(refs: Refs): void {
  const { gl, canvas, background } = refs;
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  canvas.width = Math.max(1, Math.round(Math.max(1, canvas.clientWidth) * ratio));
  canvas.height = Math.max(1, Math.round(Math.max(1, canvas.clientHeight) * ratio));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(background.program);
  setV3(gl, background, 'uTop', [0.075, 0.069, 0.064]);
  setV3(gl, background, 'uBot', [0.017, 0.016, 0.015]);
  gl.bindVertexArray(refs.emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (refs.grid === null || refs.depth === null) return;
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  const viewProj = multiply(
    perspective((FOV_DEG * Math.PI) / 180, canvas.width / canvas.height, 1, 4000),
    lookAt(cameraEye(refs.state, refs.board), [0, 0, -1.5], [0, 0, 1]),
  );
  drawSurface(refs, viewProj);
  drawSides(refs, viewProj);
}

function applyHeightfield(refs: Refs, next: RemovalGrid, stockThicknessMm: number): void {
  const { gl } = refs;
  const w = next.widthCells * next.mmPerCell;
  const h = next.heightCells * next.mmPerCell;
  let deepest = 0;
  for (const value of next.depth) deepest = Math.min(deepest, value);
  refs.board = {
    w,
    h,
    thick: Math.max(MIN_STOCK_THICKNESS_MM, stockThicknessMm),
    maxDepth: Math.max(1e-3, -deepest),
  };
  refs.texel = [1 / next.widthCells, 1 / next.heightCells];
  if (refs.depth !== null) gl.deleteTexture(refs.depth);
  refs.depth = uploadDepth(gl, next);
  // One vertex per depth cell, so the mesh never under-samples the field. Also
  // rebuilt when the carved region changes shape, which the first version did
  // not do — it kept the mesh built for whatever grid arrived first.
  const cols = Math.max(2, Math.min(next.widthCells, MAX_MESH_CELLS_ACROSS));
  const rows = Math.max(2, Math.min(next.heightCells, MAX_MESH_CELLS_ACROSS));
  if (refs.grid === null || refs.gridCols !== cols || refs.gridRows !== rows) {
    if (refs.grid !== null) gl.deleteVertexArray(refs.grid.vao);
    refs.grid = buildGrid(gl, cols, rows);
    refs.gridCols = cols;
    refs.gridRows = rows;
  }
  if (refs.sides !== null) gl.deleteVertexArray(refs.sides.vao);
  refs.sides = buildSides(gl, w, h, refs.board.thick);
}

export function createWoodViewScene(canvas: HTMLCanvasElement): WoodViewHandle | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (gl === null) return null;
  const refs: Refs = {
    gl,
    canvas,
    surface: linkProgram(gl, SURFACE_VERTEX_GLSL, SURFACE_FRAGMENT_GLSL),
    side: linkProgram(gl, SIDE_VERTEX_GLSL, SIDE_FRAGMENT_GLSL),
    background: linkProgram(gl, BACKGROUND_VERTEX_GLSL, BACKGROUND_FRAGMENT_GLSL),
    emptyVao: gl.createVertexArray(),
    state: INITIAL_WOOD_VIEW_STATE,
    grid: null,
    gridCols: 0,
    gridRows: 0,
    sides: null,
    depth: null,
    board: { w: 1, h: 1, thick: MIN_STOCK_THICKNESS_MM, maxDepth: 1 },
    texel: [1, 1],
  };
  return {
    setHeightfield: (next, stockThicknessMm) => {
      applyHeightfield(refs, next, stockThicknessMm);
      drawScene(refs);
    },
    setState: (next) => {
      refs.state = { ...refs.state, ...next };
      drawScene(refs);
    },
    getState: () => refs.state,
    render: () => drawScene(refs),
    dispose: () => {
      if (refs.depth !== null) gl.deleteTexture(refs.depth);
      if (refs.grid !== null) gl.deleteVertexArray(refs.grid.vao);
      if (refs.sides !== null) gl.deleteVertexArray(refs.sides.vao);
      gl.deleteProgram(refs.surface.program);
      gl.deleteProgram(refs.side.program);
      gl.deleteProgram(refs.background.program);
    },
  };
}
