// The camera picture's Material height follows the job's material and is
// kept between sessions (ADR-441 Amendment 14; the maintainer's choice on
// camera audit v2 K2-P2-1, "Follow material, save it"). It used to start at
// 0 mm every session and ignore the material's thickness, so the overlay of
// a camera that starts by itself was millimetres off on any stock.
//
// - At start: the job material's thickness when the project names one, else
//   the height kept from the last session.
// - When the job material's thickness changes (a material picked, a project
//   opened), the height follows it, except while a rotary applies: a part on
//   a rotary has its own top, and Job Review says so (Amendment 13).
// - A height set by hand is kept, and saved, until the material changes.
//   Job Review still says when it differs from the material (Amendment 13).

import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';

export const MATERIAL_HEIGHT_KEY = 'kerfdesk.camera.materialHeightMm';

/** The Material height kept from the last session, or null. */
export function savedMaterialHeight(): number | null {
  try {
    const value = Number(localStorage.getItem(MATERIAL_HEIGHT_KEY) ?? Number.NaN);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveMaterialHeight(heightMm: number): void {
  try {
    localStorage.setItem(MATERIAL_HEIGHT_KEY, String(heightMm));
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

/** Seed and keep the Material height; returns stop. */
export function followMaterialHeight(): () => void {
  const setHeight = (heightMm: number): void =>
    useCameraStore.getState().setSurfaceHeightMm(heightMm);
  const start = materialThickness(useStore.getState().project) ?? savedMaterialHeight();
  if (start !== null) setHeight(start);
  const stopMaterial = useStore.subscribe((state, previous) => {
    const thickness = materialThickness(state.project);
    if (thickness === null || thickness === materialThickness(previous.project)) return;
    setHeight(thickness);
  });
  const stopSave = useCameraStore.subscribe((state, previous) => {
    if (state.surfaceHeightMm !== previous.surfaceHeightMm)
      saveMaterialHeight(state.surfaceHeightMm);
  });
  return () => {
    stopMaterial();
    stopSave();
  };
}
