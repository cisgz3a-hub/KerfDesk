import type { Project } from '../../core/scene';
import { isObject } from './project-shape-primitives';

/** What a load changed that the operator is told about, by every reader. */
export type ProjectLoadNoticeFlags = {
  readonly migratedFrom?: number;
  readonly autofocusCommandRemoved?: true;
  /** Photos kept behind a trace by an earlier build, now on Output off (ADR-673 Amd 1). */
  readonly keptTracePhotosOff?: number;
};

export type LoadedProject = ProjectLoadNoticeFlags & {
  readonly kind: 'ok';
  readonly project: Project;
};

/** The notice flags alone, for a reader that keeps them beside its own result. */
export function projectLoadNoticeFlags(loaded: LoadedProject): ProjectLoadNoticeFlags {
  const { kind: _kind, project: _project, ...flags } = loaded;
  return flags;
}

/** Load-only recovery metadata stays outside the persisted project. */
export function projectLoadResult(
  raw: Record<string, unknown>,
  project: Project,
  migratedFrom: number | undefined,
  keptTracePhotosOff = 0,
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
    ...(keptTracePhotosOff > 0 ? { keptTracePhotosOff } : {}),
  };
}
