import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useStore } from '../state';
import {
  applyStampDraft,
  stampDraftImage,
  stampOwnerIsCurrent,
  type StampOwner,
} from '../state/stamp-preparation-actions';
import { prepareStampSource } from '../raster/stamp-source';
import { prepareStampInWorker } from '../raster/stamp-worker-client';
import {
  MIN_CONVERT_TO_BITMAP_DPI,
  MAX_CONVERT_TO_BITMAP_DPI,
} from '../raster/bitmap-conversion-plan';
import { proOperationMutationSetter } from '../licensing/pro-operation-mutation';
import { useToastStore } from '../state/toast-store';
import type { PlatformAdapter } from '../../platform/types';
import { exportStampDraft } from './stamp-export';
import type { ReviewedStampDraft, StampForm } from './use-stamp-preparation';
type WorkOwner = {
  readonly owner: StampOwner;
  readonly active: MutableRefObject<AbortController | null>;
  readonly revision: MutableRefObject<number>;
};
export function useStampWork(owner: StampOwner, current: boolean) {
  const [draft, setDraft] = useState<ReviewedStampDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewedState] = useState(false);
  const active = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const work = { owner, active, revision };
  const setReviewed = (value: boolean): void => {
    revision.current += 1;
    setReviewedState(value);
  };
  const invalidate = (): void => {
    revision.current += 1;
    active.current?.abort();
    active.current = null;
  };
  const reset = (): void => {
    invalidate();
    setDraft(null);
    setReviewed(false);
    setBusy(false);
    setError('');
  };
  useEffect(
    () => () => {
      revision.current += 1;
      active.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!current) {
      revision.current += 1;
      active.current?.abort();
      setBusy(false);
      setReviewed(false);
    }
  }, [current]);
  const prepare = async (form: StampForm): Promise<void> => {
    if (!stampOwnerIsCurrent(useStore.getState(), owner)) return;
    reset();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    await runStampWork(work, form, controller, { setDraft, setBusy, setError });
  };
  const ready = current && reviewed && !busy && draft !== null;
  return {
    draft,
    busy,
    error,
    reviewed,
    invalidate,
    reset,
    prepare,
    setReviewed,
    stop: () => {
      invalidate();
      setBusy(false);
    },
    apply: (close: () => void) => {
      if (ready && draft !== null) commitStamp(work, draft, close);
    },
    save: (platform: PlatformAdapter) => {
      if (ready && draft !== null) saveStamp(work, draft, platform);
    },
  };
}
type WorkUpdates = {
  readonly setDraft: (draft: ReviewedStampDraft) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: string) => void;
};
async function runStampWork(
  work: WorkOwner,
  form: StampForm,
  controller: AbortController,
  update: WorkUpdates,
): Promise<void> {
  const generation = work.revision.current;
  try {
    const values = validateForm(form);
    const source = await prepareStampSource(
      work.owner.project,
      work.owner.ids,
      values.dpi,
      controller.signal,
    );
    const pixels = await prepareStampInWorker(
      {
        source: source.pixels,
        request: { taperMm: values.taperMm, threshold: values.threshold, mirror: form.mirror },
      },
      controller.signal,
    );
    if (
      generation === work.revision.current &&
      stampOwnerIsCurrent(useStore.getState(), work.owner)
    )
      update.setDraft({ source, pixels });
  } catch (failure) {
    if (!controller.signal.aborted && generation === work.revision.current)
      update.setError(failure instanceof Error ? failure.message : 'Stamp preparation failed.');
  } finally {
    if (generation === work.revision.current) {
      work.active.current = null;
      update.setBusy(false);
    }
  }
}
function validateForm(form: StampForm) {
  const values = {
    taperMm: Number(form.taperMm),
    threshold: Number(form.threshold),
    dpi: Number(form.dpi),
  };
  if (
    [form.taperMm, form.threshold, form.dpi].some((value) => value.trim() === '') ||
    !Object.values(values).every(Number.isFinite)
  )
    throw new Error('Enter finite taper, threshold and DPI values.');
  if (values.dpi < MIN_CONVERT_TO_BITMAP_DPI || values.dpi > MAX_CONVERT_TO_BITMAP_DPI)
    throw new Error(
      `Vector DPI must be ${MIN_CONVERT_TO_BITMAP_DPI} to ${MAX_CONVERT_TO_BITMAP_DPI}.`,
    );
  if (!Number.isInteger(values.threshold) || values.threshold < 0 || values.threshold > 254)
    throw new Error('Use an integer source threshold from 0 to 254.');
  if (values.taperMm < 0 || values.taperMm > 100)
    throw new Error('Use a measured taper width from 0 to 100 mm.');
  return values;
}
function commitStamp(work: WorkOwner, draft: ReviewedStampDraft, close: () => void): void {
  const submitted = ++work.revision.current;
  const isCurrent = (): boolean =>
    submitted === work.revision.current && stampOwnerIsCurrent(useStore.getState(), work.owner);
  const image = stampDraftImage(draft.source, draft.pixels, crypto.randomUUID());
  proOperationMutationSetter(useStore.setState, useStore.getState)(
    (state) => applyStampDraft(state, work.owner, image),
    close,
    isCurrent,
  );
}
function saveStamp(work: WorkOwner, draft: ReviewedStampDraft, platform: PlatformAdapter): void {
  const submitted = work.revision.current;
  void exportStampDraft(
    platform,
    draft.pixels,
    () =>
      submitted === work.revision.current && stampOwnerIsCurrent(useStore.getState(), work.owner),
    useToastStore.getState().pushToast,
  );
}
