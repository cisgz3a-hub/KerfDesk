import { useEffect, useRef, useState } from 'react';
import {
  parseAiDraft,
  type AiAssistant,
  type AiDraft,
  type AiRequest,
  type AiStatus,
} from '../../core/ai/assistant';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { useStore } from '../state';
import { aiDraftArtwork, aiOwnerIsCurrent, applyAiDraft, type AiDocumentOwner } from './ai-artwork';

export type AiReview = {
  readonly draft: AiDraft;
  readonly request: AiRequest;
  readonly owner: AiDocumentOwner;
  readonly library: MaterialLibraryDocument | null;
};
export function useAiAssistant(assistant: AiAssistant | undefined, onClose: () => void) {
  const [error, setError] = useState('');
  const connection = useAssistantStatus(assistant, setError);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<AiReview | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const cancel = (): void => {
    if (controller.current !== null) {
      controller.current.abort();
      setError('Cancelling the request. Waiting for its connection to close.');
    }
  };
  const run = async (request: AiRequest): Promise<void> => {
    if (assistant === undefined || controller.current !== null) return;
    const state = useStore.getState();
    const owner = { project: state.project, epoch: state.projectDocumentEpoch };
    const library = state.materialLibrary;
    const active = new AbortController();
    controller.current = active;
    setError('');
    setReview(null);
    setBusy(true);
    try {
      const draft = parseAiDraft(await assistant.generate(request, active.signal), request);
      if (active.signal.aborted) {
        setError('Request cancelled.');
        return;
      }
      if (!aiOwnerIsCurrent(useStore.getState(), owner))
        throw new Error('The project changed. Request a new draft before applying it.');
      setReview({ draft, request, owner, library });
    } catch (reason) {
      if (!active.signal.aborted) setError(message(reason));
      else setError('Request cancelled.');
    } finally {
      if (controller.current === active) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  const apply = (): void => applyReview(review, onClose, setError);
  return { ...connection, error, setError, busy, review, run, cancel, apply };
}
function useAssistantStatus(assistant: AiAssistant | undefined, onError: (error: string) => void) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const revision = useRef(0);
  const acceptStatus = (value: AiStatus): void => {
    revision.current += 1;
    setStatus(value);
  };
  useEffect(() => {
    let current = true;
    const started = ++revision.current;
    if (assistant !== undefined)
      void assistant
        .status()
        .then((value) => {
          if (current && revision.current === started) setStatus(value);
        })
        .catch((reason: unknown) => {
          if (current && revision.current === started) onError(message(reason));
        });
    return () => {
      current = false;
    };
  }, [assistant, onError]);
  return { status, setStatus: acceptStatus };
}
function applyReview(
  review: AiReview | null,
  onClose: () => void,
  onError: (error: string) => void,
): void {
  if (review === null || review.request.task !== 'vector') return;
  if (!aiOwnerIsCurrent(useStore.getState(), review.owner)) {
    onError('The project changed. Request a new draft before applying it.');
    return;
  }
  const object = aiDraftArtwork(review.draft, review.request, `ai-${crypto.randomUUID()}`);
  try {
    let changed = false;
    useStore.setState((state) => {
      const patch = applyAiDraft(state, review.owner, object);
      changed = patch.project !== undefined;
      return patch;
    });
    if (changed) onClose();
    else onError('The project changed. Request a new draft before applying it.');
  } catch (reason) {
    onError(message(reason));
  }
}
function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'The assistant request failed.';
}
