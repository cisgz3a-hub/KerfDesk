import { laserPowerControlForDevice, type BuildRenderModelOptions } from '../../core/gcode-view';
import type { Project } from '../../core/scene';

export type GcodeInspectionContext = Pick<
  BuildRenderModelOptions,
  'machineKind' | 'laserPowerControl'
>;

export type GcodeInspectionSource = (
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
) &
  GcodeInspectionContext;

/** Context belongs to the compiled snapshot; arbitrary imported programs have
 * no inferred machine kind because CNC and laser share M3/M4/S words. */
export function projectInspectionContext(project: Project): GcodeInspectionContext {
  if (project.machine?.kind === 'cnc') return { machineKind: 'cnc' };
  return { machineKind: 'laser', laserPowerControl: laserPowerControlForDevice(project.device) };
}
