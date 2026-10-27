import type { BedFit } from '../../core/scene/fit-to-bed';
import type { ToastDescriptor } from '../app/import-toasts';
import type { ImportOutcome } from '../state/store';
import { useToastStore, type ToastOptions, type ToastVariant } from '../state/toast-store';

/**
 * ADR-125 Amendment 2. A remote import shows the PC the toasts the desktop import shows, and its
 * receipt carries the same text, so a bed fit, an assumed unit or a dropped part is never silent.
 */
const MAX_NOTICES = 20;
const MAX_NOTICE_LENGTH = 2048;

/** Shows the toasts on the PC once the import has committed. */
export function pushImportToasts(toasts: ReadonlyArray<ToastDescriptor>): void {
  const { pushToast } = useToastStore.getState();
  for (const toast of toasts) pushToast(toast.message, toast.variant);
}

/**
 * A PC toast sink that also keeps what it showed, for an importer that pushes its own toasts.
 * Keyed progress toasts replace each other and are left out.
 */
export function recordingPcToasts(): {
  readonly toasts: ReadonlyArray<ToastDescriptor>;
  readonly push: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
} {
  const toasts: ToastDescriptor[] = [];
  return {
    toasts,
    push: (message, variant = 'info', options = {}) => {
      useToastStore.getState().pushToast(message, variant, options);
      if (options.key === undefined) toasts.push({ message, variant });
    },
  };
}

/** Receipt fields: the PC's import notices in order, and the bed fit when one was applied. */
export function importNoticeFields(
  toasts: ReadonlyArray<ToastDescriptor>,
  outcome: ImportOutcome,
): Record<string, unknown> {
  const bedFit = outcome.kind === 'added' ? outcome.bedFit : undefined;
  return {
    notices: toasts.slice(0, MAX_NOTICES).map((toast) => ({
      level: toast.variant,
      message: toast.message.slice(0, MAX_NOTICE_LENGTH),
    })),
    ...(bedFit === undefined ? {} : { bedFit: bedFitProjection(bedFit) }),
  };
}

function bedFitProjection(fit: BedFit): Record<string, number> {
  return {
    scale: fit.scale,
    fileWidthMm: fit.widthMm,
    fileHeightMm: fit.heightMm,
    bedWidthMm: fit.bedWidthMm,
    bedHeightMm: fit.bedHeightMm,
  };
}
