import { useCallback, useEffect, useRef, useState } from 'react';
import { estimateBoxWork, type BoxPanel, type BoxSpec, type BoxSpecIssue } from '../../core/box';
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

type ActiveRequest = {
  readonly id: number;
  readonly task: BoxGenerationTask;
};

type SynchronousFallbackState = Extract<BoxGenerationState, { readonly kind: 'ready' | 'failed' }>;

type SynchronousFallbackCache = {
  readonly specKey: string;
  readonly retryToken: number;
  readonly state: SynchronousFallbackState;
};

export function useBoxGeneration(spec: BoxSpec | null): {
  readonly state: BoxGenerationState;
  readonly currentSnapshot: BoxGenerationSnapshot | null;
  readonly cancel: () => void;
  readonly retry: () => void;
} {
  const [state, setState] = useState<BoxGenerationState>({ kind: 'idle' });
  const [retryToken, setRetryToken] = useState(0);
  const nextRequestId = useRef(0);
  const active = useRef<ActiveRequest | null>(null);
  const synchronousFallbackCache = useRef<SynchronousFallbackCache | null>(null);
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
    setState({ kind: 'pending', requestId, specKey, estimate });
    const task = startBoxGeneration(requestId, requestedSpec);
    if (task === null) {
      const cached = synchronousFallbackCache.current;
      const fallbackState =
        cached?.specKey === specKey && cached.retryToken === retryToken
          ? identifySynchronousFallback(cached.state, requestId, requestedSpec, estimate)
          : createSynchronousFallbackState(requestId, specKey, requestedSpec, estimate);
      synchronousFallbackCache.current = { specKey, retryToken, state: fallbackState };
      setState(fallbackState);
      return;
    }
    active.current = { id: requestId, task };
    settleRequest(task, requestId, specKey, requestedSpec, estimate, active, setState);
    return () => cancelMatchingRequest(active, requestId);
  }, [retryToken, specKey]);

  const cancel = useCallback((): void => {
    const current = active.current;
    if (current === null) return;
    active.current = null;
    current.task.cancel();
    setState((value) =>
      value.kind === 'pending' && value.requestId === current.id
        ? { ...value, kind: 'cancelled' }
        : value,
    );
  }, []);
  const retry = useCallback((): void => setRetryToken((value) => value + 1), []);
  const currentSnapshot =
    state.kind === 'ready' && state.snapshot.specKey === specKey ? state.snapshot : null;
  return { state, currentSnapshot, cancel, retry };
}

function settleRequest(
  task: BoxGenerationTask,
  requestId: number,
  specKey: string,
  spec: BoxSpec,
  estimate: BoxWorkEstimate,
  active: React.MutableRefObject<ActiveRequest | null>,
  setState: React.Dispatch<React.SetStateAction<BoxGenerationState>>,
): void {
  void task.promise
    .then(({ result, metrics }) => {
      if (!ownsRequest(active, requestId)) return;
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
      if (error instanceof BoxGenerationCancelledError || !ownsRequest(active, requestId)) return;
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
  active: React.MutableRefObject<ActiveRequest | null>,
  requestId: number,
): boolean {
  return active.current?.id === requestId;
}

function cancelMatchingRequest(
  active: React.MutableRefObject<ActiveRequest | null>,
  requestId: number,
): void {
  if (!ownsRequest(active, requestId)) return;
  const current = active.current;
  active.current = null;
  current?.task.cancel();
}
