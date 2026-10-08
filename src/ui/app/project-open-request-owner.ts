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
  getProject?: () => unknown,
): ProjectOpenRequestOwner {
  const requestEpoch = claimRequestEpoch();
  let projectDocumentEpoch = getProjectDocumentEpoch();
  let project = getProject?.();
  const isCurrent = (): boolean =>
    getRequestEpoch() === requestEpoch &&
    getProjectDocumentEpoch() === projectDocumentEpoch &&
    (getProject === undefined || getProject() === project);
  return {
    adoptCurrentDocument: () => {
      projectDocumentEpoch = getProjectDocumentEpoch();
      project = getProject?.();
    },
    isCurrent,
    pushToast: (message, variant) => {
      if (isCurrent()) pushToast(message, variant);
    },
  };
}
