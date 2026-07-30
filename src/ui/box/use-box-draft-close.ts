import { useCallback } from 'react';
import { persistCalibrationDraft } from '../calibration/calibration-draft-storage';
import { BOX_DRAFT_KEY, type BoxDraft } from './box-draft';

/** Persist the current Box draft before closing without generating geometry. */
export function useBoxDraftClose(draft: BoxDraft, onClose: () => void): () => void {
  return useCallback(() => {
    persistCalibrationDraft(BOX_DRAFT_KEY, draft);
    onClose();
  }, [draft, onClose]);
}
