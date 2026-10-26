import type { Project } from '../../core/scene';
import { isObject } from './project-shape-primitives';

export type LoadedProject = {
  readonly kind: 'ok';
  readonly project: Project;
  readonly migratedFrom?: number;
  readonly autofocusCommandRemoved?: true;
};

/** Load-only recovery metadata stays outside the persisted project. */
export function projectLoadResult(
  raw: Record<string, unknown>,
  project: Project,
  migratedFrom: number | undefined,
): LoadedProject {
  const device = raw['device'];
  const savedFocus = isObject(device) ? device['autofocusCommand'] : undefined;
  const autofocusCommandRemoved =
    typeof savedFocus === 'string' &&
    savedFocus.trim() !== '' &&
    project.device.autofocusCommand === '';
  return {
    kind: 'ok',
    project,
    ...(migratedFrom === undefined ? {} : { migratedFrom }),
    ...(autofocusCommandRemoved ? { autofocusCommandRemoved: true as const } : {}),
  };
}
