import type { Project } from '../../core/scene';
import type { ProjectLoadNoticeFlags } from '../../io/project/project-load-metadata';
import { oldProjectBurnMessages } from './old-project-burn-messages';
import { rememberOldProjectBurn } from './old-project-burn-review';
import { burningWhiteOpenNotice } from './saved-white-notice';
import { pushNoticeGroup, type Notice } from './folded-notice';
import type { ToastOptions, ToastVariant } from './toast-store';

type PushToast = (message: string, variant?: ToastVariant, options?: ToastOptions) => void;

/** The slot a project's notices share: the next project's replace them. */
export const PROJECT_NOTICES_TOAST_KEY = 'project-notices';

// What the loader changed, said the same way by every reader of a saved
// project: File > Open (and Recent, drop, the operating system, a local
// snapshot), New from template, autosave recovery and a sheet switch
// (ADR-673 Amendment 1). File > Open names a migration in its own "Opened"
// toast, so it leaves `migration` out. With `project`, a logo whose white still
// burns is named too (ADR-686 Amendment 2): read from the artwork, so it holds
// for an autosave or a sheet whatever build wrote it.
//
// They go out as one toast, not one each (annoyance audit A5-P2-6, ADR-708):
// File > Open and New from template fold them under their own result line
// (`projectLoadNotices`), the other readers under "About this project".
type LoadNoticeOptions = {
  readonly migration: boolean;
  readonly keepEarlierReview?: boolean;
  readonly project?: Project;
};

/** `first` are the caller's own notes about the same load, said before these. */
export function pushProjectLoadNotices(
  flags: ProjectLoadNoticeFlags,
  pushToast: PushToast,
  options: LoadNoticeOptions,
  first: ReadonlyArray<Notice> = [],
): void {
  pushNoticeGroup(pushToast, PROJECT_NOTICES_TOAST_KEY, 'About this project:', [
    ...first,
    ...projectLoadNotices(flags, options),
  ]);
}

/** The notices, and Job Review's memory of an old project's burn. */
export function projectLoadNotices(
  flags: ProjectLoadNoticeFlags,
  options: LoadNoticeOptions,
): ReadonlyArray<Notice> {
  const notices: Notice[] = [];
  const warn = (message: string): void => void notices.push({ message, variant: 'warning' });
  if (options.migration && flags.migratedFrom !== undefined) {
    notices.push({
      message: `This project was saved by an earlier KerfDesk and was migrated from schema v${flags.migratedFrom}.`,
      variant: 'info',
    });
  }
  if (flags.autofocusCommandRemoved) {
    warn(
      'The saved Auto-focus command was removed because it is not supported. Review Auto-focus in Machine Settings before using it.',
    );
  }
  const photos = flags.keptTracePhotosOff ?? 0;
  if (photos > 0) warn(keptTracePhotosMessage(photos));
  // Job Review repeats these while the project is open (ADR-682 Amendment 3).
  rememberOldProjectBurn(flags.oldProjectBurn, options.keepEarlierReview === true);
  if (flags.oldProjectBurn !== undefined) {
    const { frames, burn } = oldProjectBurnMessages(flags.oldProjectBurn);
    if (frames.length > 0) warn(frames.join(' '));
    if (burn.length > 0) warn(burn.join(' '));
  }
  const white = options.project === undefined ? null : burningWhiteOpenNotice(options.project);
  if (white !== null) warn(white);
  return notices;
}

export function keptTracePhotosMessage(photos: number): string {
  return photos === 1
    ? 'This project kept a photo behind its trace, which earlier versions never engraved. Its Image operation now has Output off, so the job is unchanged. Turn that Output on to engrave the photo.'
    : `This project kept ${photos} photos behind their traces, which earlier versions never engraved. Their Image operations now have Output off, so the job is unchanged. Turn that Output on to engrave the photos.`;
}
