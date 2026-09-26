import type { CncMachineConfig, Project } from '../../core/scene';

// Laser mode parks the CNC setup on the project itself, not only in the
// store, so every save path (Save, Save As, autosave, templates) keeps the
// stock, bits, params and tiling for when the project goes back to CNC.
// A CNC project carries its setup in `machine` and never a parked copy.
export function projectWithParkedCnc(project: Project, parked: CncMachineConfig | null): Project {
  const { parkedCncMachine: previous, ...rest } = project;
  if (project.machine?.kind === 'cnc' || parked === null) {
    return previous === undefined ? project : rest;
  }
  return previous === parked ? project : { ...rest, parkedCncMachine: parked };
}
