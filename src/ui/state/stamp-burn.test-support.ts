// Shared oracles for the Prepare Stamp and Convert to Bitmap burn tests
// (tools audit T1, T32): an own G-code decoder that reports every lit move in
// scene millimetres, and a per-cell face grid that measures how much of a
// stamp's raised face the job burns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toSceneCoords } from '../../core/devices';
import { prepareStampHeight } from '../../core/raster/stamp-height';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_OPTIMIZATION,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { lumaToBase64 } from '../raster/luma-bitmap';
import { prepareStampSource } from '../raster/stamp-source';
import { applyStampDraft, stampDraftImage } from './stamp-preparation-actions';
import { useStore } from './store';

export type Point = { readonly x: number; readonly y: number };
export type LitMove = {
  readonly a: Point;
  readonly b: Point;
  readonly s: number;
  readonly len: number;
};

export function fontBuffer(fileName: string): ArrayBuffer {
  const bytes = readFileSync(resolve(process.cwd(), 'src/ui/text/fonts', fileName));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Every G1 move with the laser on and S > 0, in scene coordinates. */
export function decodeLitMoves(gcode: string, project: Project): LitMove[] {
  const modal: Modal = { x: 0, y: 0, s: 0, motion: 0, on: false, absolute: true };
  const moves: LitMove[] = [];
  for (const raw of gcode.split(/\r?\n/u)) {
    const line = (raw.split(';')[0] ?? '')
      .replace(/\([^)]*\)/gu, '')
      .trim()
      .toUpperCase();
    const axes: { x?: number; y?: number } = {};
    for (const word of line.match(/[A-Z][-+]?[0-9]*\.?[0-9]+/gu) ?? [])
      applyWord(modal, axes, word[0] ?? '', Number(word.slice(1)));
    if (axes.x === undefined && axes.y === undefined) continue;
    const tx = target(modal.x, axes.x, modal.absolute);
    const ty = target(modal.y, axes.y, modal.absolute);
    if (modal.motion === 1 && modal.on && modal.s > 0) {
      const a = toSceneCoords({ x: modal.x, y: modal.y }, project.device);
      const b = toSceneCoords({ x: tx, y: ty }, project.device);
      moves.push({ a, b, s: modal.s, len: Math.hypot(b.x - a.x, b.y - a.y) });
    }
    modal.x = tx;
    modal.y = ty;
  }
  return moves;
}

type Modal = { x: number; y: number; s: number; motion: number; on: boolean; absolute: boolean };

function applyWord(
  modal: Modal,
  axes: { x?: number; y?: number },
  letter: string,
  value: number,
): void {
  if (letter === 'G') applyG(modal, value);
  else if (letter === 'M' && (value === 3 || value === 4)) modal.on = true;
  else if (letter === 'M' && (value === 5 || value === 2 || value === 30)) modal.on = false;
  else if (letter === 'S') modal.s = value;
  else if (letter === 'X') axes.x = value;
  else if (letter === 'Y') axes.y = value;
}

function applyG(modal: Modal, value: number): void {
  if (value === 0 || value === 1) modal.motion = value;
  else if (value === 90) modal.absolute = true;
  else if (value === 91) modal.absolute = false;
}

function target(current: number, word: number | undefined, absolute: boolean): number {
  if (word === undefined) return current;
  return absolute ? word : current + word;
}

export function burn(project: Project): LitMove[] {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error(`prepareOutput refused: ${JSON.stringify(prepared)}`);
  return decodeLitMoves(emitPreparedGcode(prepared).gcode, project);
}

export type FaceGrid = {
  readonly minX: number;
  readonly minY: number;
  readonly nx: number;
  readonly ny: number;
  readonly step: number;
  readonly face: Uint8Array;
  readonly faceCells: number;
};

export function faceGrid(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  step: number,
  isFace: (x: number, y: number) => boolean,
): FaceGrid {
  const nx = Math.round((rect.maxX - rect.minX) / step);
  const ny = Math.round((rect.maxY - rect.minY) / step);
  const face = new Uint8Array(nx * ny);
  let faceCells = 0;
  for (let j = 0; j < ny; j += 1)
    for (let i = 0; i < nx; i += 1)
      if (isFace(rect.minX + (i + 0.5) * step, rect.minY + (j + 0.5) * step)) {
        face[j * nx + i] = 1;
        faceCells += 1;
      }
  return { minX: rect.minX, minY: rect.minY, nx, ny, step, face, faceCells };
}

/** Lit length on face cells, and the share of face cells the job burns. */
export function faceBurn(moves: ReadonlyArray<LitMove>, grid: FaceGrid) {
  const hit = new Uint8Array(grid.nx * grid.ny);
  let onFaceMm = 0;
  for (const move of moves) {
    const samples = Math.max(1, Math.ceil(move.len / 0.01));
    for (let k = 0; k < samples; k += 1) {
      const t = (k + 0.5) / samples;
      const i = Math.floor((move.a.x + (move.b.x - move.a.x) * t - grid.minX) / grid.step);
      const j = Math.floor((move.a.y + (move.b.y - move.a.y) * t - grid.minY) / grid.step);
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny || grid.face[j * grid.nx + i] !== 1)
        continue;
      onFaceMm += move.len / samples;
      hit[j * grid.nx + i] = 1;
    }
  }
  const burnedCells = hit.reduce((sum, value) => sum + value, 0);
  return { onFaceMm, burnedShare: burnedCells / grid.faceCells };
}

export function evenOdd(x: number, y: number, rings: ReadonlyArray<ReadonlyArray<Point>>): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i] as Point;
      const b = ring[j] as Point;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
  return inside;
}

export const operation = (
  id: string,
  mode: 'fill' | 'image',
  extra: Partial<Layer> = {},
): Layer => ({
  // eslint-disable-next-line no-restricted-syntax -- scene-data operation colour, not UI chrome
  ...createLayer({ id, color: '#000000', name: id, mode }),
  ...extra,
});

export function stampProject(
  objects: SceneObject[],
  layers: Layer[],
  extra: Partial<Project> = {},
): Project {
  const base = createProject();
  return {
    ...base,
    optimization: { ...DEFAULT_PROJECT_OPTIMIZATION },
    scene: { ...base.scene, objects, layers, groups: [] },
    ...extra,
  };
}

/** The real Prepare Stamp path with the worker's one computation in-thread. */
export async function applyStamp(
  project: Project,
  ids: string[],
  options: { taperMm?: number; mirror?: boolean } = {},
) {
  useStore.setState({
    project,
    projectDocumentEpoch: 3,
    selectedObjectId: ids[0] ?? null,
    additionalSelectedIds: new Set(ids.slice(1)),
    undoStack: [],
    redoStack: [],
  });
  const source = await prepareStampSource(project, ids, 254, new AbortController().signal);
  const height = prepareStampHeight(source.pixels, {
    threshold: 127,
    taperMm: options.taperMm ?? 0.5,
    mirror: options.mirror ?? true,
  });
  const { face, luma, ...dimensions } = height;
  const draft = {
    ...dimensions,
    dataUrl: 'data:image/png;base64,AA==',
    lumaBase64: lumaToBase64(luma),
    sourceDataUrl: '',
    faceDataUrl: '',
  };
  const image = stampDraftImage(source, draft, 'STAMP');
  useStore.setState((state) => applyStampDraft(state, { project, documentEpoch: 3, ids }, image));
  const after = useStore.getState().project;
  const stamp = after.scene.objects.find((object) => object.id === 'STAMP') as RasterImage;
  return { source, height, face, image, stamp, after };
}
