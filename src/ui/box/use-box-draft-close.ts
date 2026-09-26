import { useCallback } from 'react';
import { persistCalibrationDraft } from '../calibration/calibration-draft-storage';
import type { BoxDraft } from './box-draft';

/** Persist the current Box draft under its machine's key before closing
 * without generating geometry. */
export function useBoxDraftClose(
  draftKey: string,
  draft: BoxDraft,
  onClose: () => void,
): () => void {
  return useCallback(() => {
    persistCalibrationDraft(draftKey, draft);
    onClose();
  }, [draftKey, draft, onClose]);
}
