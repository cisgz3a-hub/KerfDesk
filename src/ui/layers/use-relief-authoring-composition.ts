import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import { reliefAuthoringError } from '../../core/relief/relief-authoring-validation';
import { useStore } from '../state';
import { composeReliefInWorker } from './relief-authoring-worker-client';

type ReliefPreview = {
  owner: HeightfieldReliefObject;
  epoch: number;
  document: ReliefAuthoringDocument;
  field: ReliefHeightfield;
  warnings: ReadonlyArray<string>;
};
type CompositionContext = {
  readonly relief: HeightfieldReliefObject;
  readonly epoch: number;
  readonly request: MutableRefObject<AbortController | null>;
  readonly setBusy: (busy: boolean) => void;
  readonly setProgress: (progress: number) => void;
  readonly setMessage: (message: string) => void;
  readonly setPreview: (preview: ReliefPreview | null) => void;
};
function abortCompositionRequest(request: MutableRefObject<AbortController | null>): void {
  const controller = request.current;
  request.current = null;
  controller?.abort();
}
function currentOwner(relief: HeightfieldReliefObject, epoch: number): boolean {
  const state = useStore.getState();
  return (
    state.projectDocumentEpoch === epoch &&
    state.project.scene.objects.find((o) => o.id === relief.id) === relief
  );
}
async function prepareCandidate(
  requested: ReliefAuthoringDocument,
  previewOnly: boolean,
  context: CompositionContext,
): Promise<void> {
  const { relief, epoch, request, setBusy, setProgress, setMessage, setPreview } = context;
  // This path owns explicit edits. Loading and automatic linked refresh retain
  // the saved interpretation until the operator chooses to edit the relief.
  const candidate: ReliefAuthoringDocument = {
    ...requested,
    algorithmRevision: 'retained-relief-v2',
  };
  request.current?.abort();
  const controller = new AbortController();
  request.current = controller;
  const error = reliefAuthoringError(candidate);
  if (error !== null) {
    setBusy(false);
    setMessage(error);
    return;
  }
  setBusy(true);
  setProgress(0);
  setMessage('');
  const result = await composeReliefInWorker(candidate, controller.signal, setProgress);
  if (controller.signal.aborted || request.current !== controller) return;
  setBusy(false);
  if (!currentOwner(relief, epoch)) {
    setMessage('This relief changed during preparation. The edit was not applied.');
    return;
  }
  if (result.kind !== 'ok') {
    if (result.kind === 'error') setMessage(result.reason);
    return;
  }
  if (previewOnly) {
    setPreview({
      owner: relief,
      epoch,
      document: candidate,
      field: result.field,
      warnings: result.warnings,
    });
    return;
  }
  const accepted = useStore
    .getState()
    .commitReliefAuthoring(
      relief.id,
      relief.reliefAuthoring?.revision ?? null,
      candidate,
      result.field,
      { source: relief.reliefSource, documentEpoch: epoch },
    );
  setMessage(
    accepted
      ? result.warnings.join(' ')
      : 'This relief changed during preparation. The edit was not applied.',
  );
}
function commitPreview(
  preview: ReliefPreview | null,
  setMessage: (message: string) => void,
  setPreview: (preview: ReliefPreview | null) => void,
): boolean {
  if (preview === null) return false;
  if (!currentOwner(preview.owner, preview.epoch)) {
    setMessage('This relief changed. The component preview was not applied.');
    setPreview(null);
    return false;
  }
  const accepted = useStore
    .getState()
    .commitReliefAuthoring(
      preview.owner.id,
      preview.owner.reliefAuthoring?.revision ?? null,
      preview.document,
      preview.field,
      { source: preview.owner.reliefSource, documentEpoch: preview.epoch },
    );
  setMessage(
    accepted
      ? preview.warnings.join(' ')
      : 'This relief changed. The component preview was not applied.',
  );
  if (accepted) setPreview(null);
  return accepted;
}
export function useReliefAuthoringComposition(relief: HeightfieldReliefObject) {
  const epoch = useStore((s) => s.projectDocumentEpoch);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ReliefPreview | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    request.current?.abort();
    setBusy(false);
    setPreview(null);
    return () => abortCompositionRequest(request);
  }, [
    relief.id,
    relief.reliefSource,
    relief.transform,
    relief.targetWidthMm,
    relief.reliefDepthMm,
    epoch,
  ]);
  return {
    busy,
    progress,
    message,
    setMessage,
    preview,
    setPreview,
    prepare: (candidate: ReliefAuthoringDocument, previewOnly = false) =>
      prepareCandidate(candidate, previewOnly, {
        relief,
        epoch,
        request,
        setBusy,
        setProgress,
        setMessage,
        setPreview,
      }),
    cancel: () => {
      request.current?.abort();
      setBusy(false);
    },
    commitPreview: () => commitPreview(preview, setMessage, setPreview),
  };
}
