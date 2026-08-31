import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export type ProjectOpenRequestOwner = {
  readonly adoptCurrentDocument: () => void;
  readonly isCurrent: () => boolean;
  readonly pushToast: PushToast;
};

export function claimProjectOpenRequest(
  pushToast: PushToast,
  claimRequestEpoch: () => number,
  getRequestEpoch: () => number,
  getProjectDocumentEpoch: () => number,
): ProjectOpenRequestOwner {
  const requestEpoch = claimRequestEpoch();
  let projectDocumentEpoch = getProjectDocumentEpoch();
  const isCurrent = (): boolean =>
    getRequestEpoch() === requestEpoch && getProjectDocumentEpoch() === projectDocumentEpoch;
  return {
    adoptCurrentDocument: () => {
      projectDocumentEpoch = getProjectDocumentEpoch();
    },
    isCurrent,
    pushToast: (message, variant) => {
      if (isCurrent()) pushToast(message, variant);
    },
  };
}
