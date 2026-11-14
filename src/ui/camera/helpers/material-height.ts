// The camera picture's Material height follows the job's material and is
// kept between sessions (ADR-441 Amendment 14; the maintainer's choice on
// camera audit v2 K2-P2-1, "Follow material, save it"). It used to start at
// 0 mm every session and ignore the material's thickness, so the overlay of
// a camera that starts by itself was millimetres off on any stock.
//
// - When the project names a material (and no rotary applies), the height
//   follows its thickness: at start, when a project is opened or made, and
//   when the material changes.
// - A height is kept, and saved, together with what it was set for
//   (Amendment 15, camera audit v2 K6-P1-1): a rotary part of one diameter, a
//   material of one thickness, or nothing named. It comes back only for the
//   same rotary part. A project that names no material starts at 0 mm: an
//   85 mm height kept from a tumbler job drew the next flat job's picture
//   46-83 mm off, and nothing could say so. Job Review now says when a
//   project that names no material is drawn above 0 mm (Amendment 13's rule).
// - A rotary part has its own top, so the material is not followed while a
//   rotary applies, and Job Review says when the height is too low.

import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';

export const MATERIAL_HEIGHT_KEY = 'kerfdesk.camera.materialHeightMm';

/** A kept Material height and what it was set for. */
export type SavedMaterialHeight = { readonly heightMm: number; readonly setFor: string };

/** The Material height kept from the last session, or null. */
export function savedMaterialHeight(): SavedMaterialHeight | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MATERIAL_HEIGHT_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { heightMm, setFor } = value as Record<string, unknown>;
    return typeof heightMm === 'number' &&
      Number.isFinite(heightMm) &&
      heightMm >= 0 &&
      typeof setFor === 'string'
      ? { heightMm, setFor }
      : null;
  } catch {
    // Unreadable, or a plain number from before Amendment 15: nothing kept.
    return null;
  }
}

function saveMaterialHeight(saved: SavedMaterialHeight): void {
  try {
    localStorage.setItem(MATERIAL_HEIGHT_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable: the height lasts for this session only.
  }
}

// The thickness the height should follow, or null when it should not.
function materialThickness(project: Project): number | null {
  if (rotaryAppliesTo(project.device, project.machine)) return null;
  const thickness = project.jobSetup.laserMaterial?.thicknessMm;
  return thickness !== undefined && Number.isFinite(thickness) && thickness >= 0 ? thickness : null;
}

/** What a height set now is set for: a rotary part, a material, or nothing named. */
export function materialHeightSetFor(project: Project): string {
  const rotary = project.device.rotary;
  if (rotaryAppliesTo(project.device, project.machine) && rotary !== undefined)
    return `rotary:${rotary.objectDiameterMm}`;
  const thickness = materialThickness(project);
  return thickness === null ? 'none' : `material:${thickness}`;
}

/** The height a project starts at: its material, the same rotary part's kept height, else 0. */
export function startingMaterialHeight(project: Project): number {
  const thickness = materialThickness(project);
  if (thickness !== null) return thickness;
  const saved = savedMaterialHeight();
  const setFor = materialHeightSetFor(project);
  return saved !== null && setFor.startsWith('rotary:') && saved.setFor === setFor
    ? saved.heightMm
    : 0;
}

/** Seed and keep the Material height; returns stop. */
export function followMaterialHeight(): () => void {
  const setHeight = (heightMm: number): void =>
    useCameraStore.getState().setSurfaceHeightMm(heightMm);
  setHeight(startingMaterialHeight(useStore.getState().project));
  const stopMaterial = useStore.subscribe((state, previous) => {
    // A project opened or made starts again (Amendment 15).
    if (state.projectDocumentEpoch !== previous.projectDocumentEpoch) {
      setHeight(startingMaterialHeight(state.project));
      return;
    }
    const thickness = materialThickness(state.project);
    if (thickness === null || thickness === materialThickness(previous.project)) return;
    setHeight(thickness);
  });
  const stopSave = useCameraStore.subscribe((state, previous) => {
    if (state.surfaceHeightMm === previous.surfaceHeightMm) return;
    saveMaterialHeight({
      heightMm: state.surfaceHeightMm,
      setFor: materialHeightSetFor(useStore.getState().project),
    });
  });
  return () => {
    stopMaterial();
    stopSave();
  };
}
