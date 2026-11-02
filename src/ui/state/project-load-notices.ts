import type { ProjectLoadNoticeFlags } from '../../io/project/project-load-metadata';
import { oldProjectBurnMessages } from './old-project-burn-messages';
import { rememberOldProjectBurn } from './old-project-burn-review';
import type { ToastVariant } from './toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

// What the loader changed, said the same way by every reader of a saved
// project: File > Open (and Recent, drop, the operating system, a local
// snapshot), New from template, autosave recovery and a sheet switch
// (ADR-673 Amendment 1). File > Open names a migration in its own "Opened"
// toast, so it leaves `migration` out.
export function pushProjectLoadNotices(
  flags: ProjectLoadNoticeFlags,
  pushToast: PushToast,
  options: { readonly migration: boolean; readonly keepEarlierReview?: boolean },
): void {
  if (options.migration && flags.migratedFrom !== undefined) {
    pushToast(
      `This project was saved by an earlier KerfDesk and was migrated from schema v${flags.migratedFrom}.`,
      'info',
    );
  }
  if (flags.autofocusCommandRemoved) {
    pushToast(
      'The saved Auto-focus command was removed because it is not supported. Review Auto-focus in Machine Settings before using it.',
      'warning',
    );
  }
  const photos = flags.keptTracePhotosOff ?? 0;
  if (photos > 0) pushToast(keptTracePhotosMessage(photos), 'warning');
  // Job Review repeats these while the project is open (ADR-682 Amendment 3).
  rememberOldProjectBurn(flags.oldProjectBurn, options.keepEarlierReview === true);
  // Two toasts at most: only the newest three render, with "Opened" before them.
  if (flags.oldProjectBurn !== undefined) {
    const { frames, burn } = oldProjectBurnMessages(flags.oldProjectBurn);
    if (frames.length > 0) pushToast(frames.join(' '), 'warning');
    if (burn.length > 0) pushToast(burn.join(' '), 'warning');
  }
}

export function keptTracePhotosMessage(photos: number): string {
  return photos === 1
    ? 'This project kept a photo behind its trace, which earlier versions never engraved. Its Image operation now has Output off, so the job is unchanged. Turn that Output on to engrave the photo.'
    : `This project kept ${photos} photos behind their traces, which earlier versions never engraved. Their Image operations now have Output off, so the job is unchanged. Turn that Output on to engrave the photos.`;
}
