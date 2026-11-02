import type { Project } from '../../core/scene';
import { isObject } from './project-shape-primitives';

/** What a load changed that the operator is told about, by every reader. */
export type ProjectLoadNoticeFlags = {
  readonly migratedFrom?: number;
  readonly autofocusCommandRemoved?: true;
  /** Photos kept behind a trace by an earlier build, now on Output off (ADR-673 Amd 1). */
  readonly keptTracePhotosOff?: number;
  /** What this older project burns differently now (ADR-682 Amendment 3). */
  readonly oldProjectBurn?: OldProjectBurnNotice;
};

type InkSize = { readonly widthMm: number; readonly heightMm: number };
type NoticedObject = { readonly objectId: string; readonly label: string };

export type OldProjectBurnNotice = {
  /** Frames that got their old line rule back. `record` is set on variable text. */
  readonly repairedFrames: ReadonlyArray<
    NoticedObject & { readonly record?: string; readonly before: InkSize; readonly after: InkSize }
  >;
  /** Variable frames the file cannot place. `now` is the em rule, `before` the old one. */
  readonly uncertainFrames: ReadonlyArray<
    NoticedObject & { readonly record?: string; readonly now?: InkSize; readonly before?: InkSize }
  >;
  readonly movedRecords: ReadonlyArray<NoticedObject>;
  readonly imageDose: ReadonlyArray<
    NoticedObject & { readonly change: 'dot-width' | 'turned-pass-through' }
  >;
  /** A CNC job whose cut moved, in machine mm, when the Job Origin anchor began
   *  to count every contour it cuts (rolling audit v9 R8-P2-1). At most one. */
  readonly cncJobOrigin: ReadonlyArray<{ readonly xMm: number; readonly yMm: number }>;
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
  oldProjectBurn?: OldProjectBurnNotice,
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
    ...(oldProjectBurn === undefined ? {} : { oldProjectBurn }),
  };
}
