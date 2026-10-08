import { useState } from 'react';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { stampOwnerIsCurrent, type StampOwner } from '../state/stamp-preparation-actions';
import { usePlatform } from '../app/platform-context';
import { useStampWork } from './use-stamp-work';
import type { PreparedStampSource } from '../raster/stamp-source';
import type { StampEncodedDraft } from '../raster/stamp-worker-protocol';
export type StampForm = {
  readonly taperMm: string;
  readonly threshold: string;
  readonly dpi: string;
  readonly mirror: boolean;
};
export type ReviewedStampDraft = {
  readonly source: PreparedStampSource;
  readonly pixels: StampEncodedDraft;
};
export function useStampPreparation(onClose: () => void) {
  const state = useStore();
  const platform = usePlatform();
  const [owner] = useState<StampOwner>(() => ({
    project: state.project,
    documentEpoch: state.projectDocumentEpoch,
    ids: selectedObjectIds(state),
  }));
  const [form, setForm] = useState<StampForm>({
    taperMm: '0.5',
    threshold: '127',
    dpi: '254',
    mirror: true,
  });
  const [preview, setPreview] = useState<'source' | 'face' | 'height'>('height');
  const current = stampOwnerIsCurrent(state, owner);
  const work = useStampWork(owner, current);
  const close = (): void => {
    work.invalidate();
    onClose();
  };
  const change = (patch: Partial<StampForm>): void => {
    work.reset();
    setForm((previous) => ({ ...previous, ...patch }));
  };
  return {
    owner,
    form,
    preview,
    current,
    ...work,
    change,
    close,
    setPreview,
    prepare: () => work.prepare(form),
    apply: () => work.apply(close),
    save: () => work.save(platform),
  };
}
export type StampPreparationReview = ReturnType<typeof useStampPreparation>;
