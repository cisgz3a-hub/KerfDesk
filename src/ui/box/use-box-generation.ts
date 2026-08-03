import { useCallback, useEffect, useRef, useState } from 'react';
import { estimateBoxWork, type BoxPanel, type BoxSpec, type BoxSpecIssue } from '../../core/box';
import { BOX_GENERATION_QUIET_WINDOW_MS, isImmediateDispatch } from './box-generation-quiet-window';
import {
  BoxGenerationCancelledError,
  startBoxGeneration,
  type BoxGenerationTask,
} from './box-generation-worker-client';
import type { BoxGenerationMetrics } from './box-generation-worker-protocol';
import { runBoxGenerationRequest } from './box-generation-worker-runtime';

type BoxWorkEstimate = ReturnType<typeof estimateBoxWork>;
export type BoxGenerationMode = 'worker' | 'synchronous-fallback';

export type BoxGenerationSnapshot = {
  readonly requestId: number;
  readonly specKey: string;
  readonly spec: BoxSpec;
  readonly panels: ReadonlyArray<BoxPanel>;
  readonly estimate: BoxWorkEstimate;
  readonly metrics: BoxGenerationMetrics;
  readonly generationMode: BoxGenerationMode;
};

export type BoxGenerationFailure =
  | { readonly kind: 'worker'; readonly message: string }
  | {
      readonly kind: 'invalid';
      readonly issues: ReadonlyArray<BoxSpecIssue>;
      readonly warnings: ReadonlyArray<BoxSpecIssue>;
    }
  | { readonly kind: 'generation'; readonly message: string };

export type BoxGenerationState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pending';
      readonly requestId: number;
      readonly specKey: string;
      readonly estimate: BoxWorkEstimate;
    }
  | { readonly kind: 'ready'; readonly snapshot: BoxGenerationSnapshot }
  | {
      readonly kind: 'failed';
      readonly requestId: number;
      readonly specKey: string;
      readonly estimate: BoxWorkEstimate;
      readonly failure: BoxGenerationFailure;
      readonly generationMode: BoxGenerationMode;
    }
  | {
      readonly kind: 'cancelled';
      readonly requestId: number;
      readonly specKey: string;
      readonly estimate: BoxWorkEstimate;
    };

type SynchronousFallbackState = Extract<BoxGenerationState, { readonly kind: 'ready' | 'failed' }>;

type SynchronousFallbackCache = {
  readonly specKey: string;
  readonly retryToken: number;
  readonly state: SynchronousFallbackState;
};

type DispatchInput = {
  readonly requestId: number;
  readonly specKey: string;
  readonly spec: BoxSpec;
  readonly estimate: BoxWorkEstimate;
  readonly retryToken: number;
};

type DispatchTargets = {
  readonly active: React.MutableRefObject<BoxGenerationTask | null>;
  readonly fallbackCache: React.MutableRefObject<SynchronousFallbackCache | null>;
  readonly setState: React.Dispatch<React.SetStateAction<BoxGenerationState>>;
};

type HeldDispatchRef = React.MutableRefObject<ReturnType<typeof setTimeout> | null>;

export function useBoxGeneration(spec: BoxSpec | null): {
  readonly state: BoxGenerationState;
  readonly currentSnapshot: BoxGenerationSnapshot | null;
  readonly cancel: () => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<BoxGenerationState>({ kind: 'idle' });
  const [retryToken, setRetryToken] = useState(0);
  // Identifies the request to the status UI only. It restarts whenever the
  // dialog remounts, so it must never be used to route worker responses.
  const nextRequestId = useRef(0);
  const active = useRef<BoxGenerationTask | null>(null);
  const synchronousFallbackCache = useRef<SynchronousFallbackCache | null>(null);
  const heldDispatch = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSupersededLiveWork = useRef(false);
  const lastRetryToken = useRef(retryToken);
  const specRef = useRef(spec);
  specRef.current = spec;
  const specKey = spec === null ? null : JSON.stringify(spec);

  useEffect(() => {
    const requestedSpec = specRef.current;
    if (requestedSpec === null || specKey === null) {
      setState({ kind: 'idle' });
      return;
    }
    nextRequestId.current += 1;
    const requestId = nextRequestId.current;
    const estimate = estimateBoxWork(requestedSpec);
    // Pending is entered as soon as the spec changes, whether or not the
    // request is held: the preview on screen no longer matches the form.
    setState({ kind: 'pending', requestId, specKey, estimate });
    const input: DispatchInput = { requestId, specKey, spec: requestedSpec, estimate, retryToken };
    const targets = { active, fallbackCache: synchronousFallbackCache, setState };
    // The client mints the worker request id when the request is actually
    // posted, which the quiet window can defer past this effect body.
    let dispatchedId: number | null = null;
    const dispatch = (): void => {
      heldDispatch.current = null;
      dispatchedId = dispatchRequest(input, targets);
    };
    const isImmediate = isImmediateDispatch({
      isRetry: lastRetryToken.current !== retryToken,
      hasSupersededLiveWork: hasSupersededLiveWork.current,
    });
    lastRetryToken.current = retryToken;
    hasSupersededLiveWork.current = false;
    if (isImmediate) dispatch();
    else heldDispatch.current = setTimeout(dispatch, BOX_GENERATION_QUIET_WINDOW_MS);
    return () => {
      // A still-held dispatch counts as live work: whatever replaces it must
      // re-arm the quiet window instead of dispatching straight away.
      if (heldDispatch.current !== null) hasSupersededLiveWork.current = true;
      clearHeldDispatch(heldDispatch);
      cancelMatchingRequest(active, dispatchedId, hasSupersededLiveWork);
    };
  }, [retryToken, specKey]);

  const cancel = useCallback((): void => {
    // Cancel must also drop a dispatch that is still inside the quiet window,
    // otherwise the operator's Cancel would be undone when the timer fires.
    clearHeldDispatch(heldDispatch);
    const current = active.current;
    active.current = null;
    current?.cancel();
    setState((value) => (value.kind === 'pending' ? { ...value, kind: 'cancelled' } : value));
  }, []);
  const retry = useCallback((): void => setRetryToken((value) => value + 1), []);
  const currentSnapshot =
    state.kind === 'ready' && state.snapshot.specKey === specKey ? state.snapshot : null;
  return { state, currentSnapshot, cancel, retry };
}

function clearHeldDispatch(heldDispatch: HeldDispatchRef): void {
  if (heldDispatch.current === null) return;
  clearTimeout(heldDispatch.current);
  heldDispatch.current = null;
}

// Returns the worker request id this dispatch owns, or null when no worker was
// available and the spec was generated on the main thread instead.
function dispatchRequest(input: DispatchInput, targets: DispatchTargets): number | null {
  const task = startBoxGeneration(input.spec);
  if (task === null) {
    targets.setState(applySynchronousFallback(input, targets.fallbackCache));
    return null;
  }
  targets.active.current = task;
  settleRequest(task, input, targets.active, targets.setState);
  return task.id;
}

function applySynchronousFallback(
  input: DispatchInput,
  fallbackCache: React.MutableRefObject<SynchronousFallbackCache | null>,
): SynchronousFallbackState {
  const cached = fallbackCache.current;
  const state =
    cached?.specKey === input.specKey && cached.retryToken === input.retryToken
      ? identifySynchronousFallback(cached.state, input.requestId, input.spec, input.estimate)
      : createSynchronousFallbackState(input.requestId, input.specKey, input.spec, input.estimate);
  fallbackCache.current = { specKey: input.specKey, retryToken: input.retryToken, state };
  return state;
}

function settleRequest(
  task: BoxGenerationTask,
  input: DispatchInput,
  active: React.MutableRefObject<BoxGenerationTask | null>,
  setState: React.Dispatch<React.SetStateAction<BoxGenerationState>>,
): void {
  const { requestId, specKey, spec, estimate } = input;
  void task.promise
    .then(({ result, metrics }) => {
      if (!ownsRequest(active, task.id)) return;
      active.current = null;
      if (result.kind === 'generated' && metrics !== null) {
        setState({
          kind: 'ready',
          snapshot: {
            requestId,
            specKey,
            spec,
            panels: result.panels,
            estimate,
            metrics,
            generationMode: 'worker',
          },
        });
        return;
      }
      setState({
        kind: 'failed',
        requestId,
        specKey,
        estimate,
        failure: failureFromResult(result, metrics),
        generationMode: 'worker',
      });
    })
    .catch((error: unknown) => {
      if (error instanceof BoxGenerationCancelledError || !ownsRequest(active, task.id)) return;
      active.current = null;
      setState({
        kind: 'failed',
        requestId,
        specKey,
        estimate,
        failure: {
          kind: 'worker',
          message: error instanceof Error ? error.message : String(error),
        },
        generationMode: 'worker',
      });
    });
}

function createSynchronousFallbackState(
  requestId: number,
  specKey: string,
  spec: BoxSpec,
  estimate: BoxWorkEstimate,
): SynchronousFallbackState {
  try {
    const response = runBoxGenerationRequest({ kind: 'generate', id: requestId, spec });
    if (response.kind === 'result' && response.result.kind === 'generated' && response.metrics) {
      return {
        kind: 'ready',
        snapshot: {
          requestId,
          specKey,
          spec,
          panels: response.result.panels,
          estimate,
          metrics: response.metrics,
          generationMode: 'synchronous-fallback',
        },
      };
    }
    if (response.kind === 'result') {
      return {
        kind: 'failed',
        requestId,
        specKey,
        estimate,
        failure: failureFromResult(response.result, response.metrics),
        generationMode: 'synchronous-fallback',
      };
    }
    return {
      kind: 'failed',
      requestId,
      specKey,
      estimate,
      failure: { kind: 'worker', message: response.message },
      generationMode: 'synchronous-fallback',
    };
  } catch (error: unknown) {
    return {
      kind: 'failed',
      requestId,
      specKey,
      estimate,
      failure: {
        kind: 'generation',
        message: error instanceof Error ? error.message : String(error),
      },
      generationMode: 'synchronous-fallback',
    };
  }
}

function identifySynchronousFallback(
  state: SynchronousFallbackState,
  requestId: number,
  spec: BoxSpec,
  estimate: BoxWorkEstimate,
): SynchronousFallbackState {
  if (state.kind === 'ready') {
    return {
      kind: 'ready',
      snapshot: { ...state.snapshot, requestId, spec, estimate },
    };
  }
  return { ...state, requestId, estimate };
}

function failureFromResult(
  result: Awaited<BoxGenerationTask['promise']>['result'],
  metrics: BoxGenerationMetrics | null,
): BoxGenerationFailure {
  if (result.kind === 'invalid') {
    return { kind: 'invalid', issues: result.issues, warnings: result.warnings };
  }
  if (result.kind === 'error') return { kind: 'generation', message: result.message };
  return {
    kind: 'worker',
    message:
      metrics === null
        ? 'Background box generation returned incomplete result metadata.'
        : 'Background box generation returned an unexpected result.',
  };
}

function ownsRequest(
  active: React.MutableRefObject<BoxGenerationTask | null>,
  requestId: number,
): boolean {
  return active.current?.id === requestId;
}

// A null id means this effect never reached the worker — a still-held dispatch
// or a synchronous fallback — so there is nothing of its own to cancel.
function cancelMatchingRequest(
  active: React.MutableRefObject<BoxGenerationTask | null>,
  requestId: number | null,
  hasSupersededLiveWork: React.MutableRefObject<boolean>,
): void {
  if (requestId === null || !ownsRequest(active, requestId)) return;
  const current = active.current;
  active.current = null;
  current?.cancel();
  hasSupersededLiveWork.current = true;
}
