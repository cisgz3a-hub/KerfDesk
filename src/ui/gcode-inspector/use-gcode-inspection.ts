import { useEffect, useState } from 'react';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { inspectGcodeText } from './gcode-inspector-parse';
import { inspectGcodeOffThread } from './gcode-inspector-worker-client';
import type { GcodeInspectorWorkerResult } from './gcode-inspector-worker-protocol';

export type InspectionState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly phase: 'queued' | 'reading' | 'parsing' | 'fallback';
      readonly queuePosition: number;
      readonly bytesRead?: number;
      readonly totalBytes?: number;
    }
  | {
      readonly kind: 'ready';
      readonly result: GcodeInspectorWorkerResult;
      readonly source: GcodeInspectionSource;
      readonly mainThreadFallback: boolean;
    }
  | { readonly kind: 'error'; readonly reason: string };

export function useGcodeInspection(source: GcodeInspectionSource | null): InspectionState {
  const [state, setState] = useState<InspectionState>({ kind: 'idle' });
  useEffect(() => {
    if (source === null) {
      setState({ kind: 'idle' });
      return;
    }
    let isCurrent = true;
    const controller = new AbortController();
    setState({ kind: 'loading', phase: 'queued', queuePosition: 0 });
    const offThread = inspectGcodeOffThread(source, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (isCurrent) setState({ kind: 'loading', ...progress });
      },
    });
    const mainThreadFallback = offThread === null;
    if (mainThreadFallback) {
      setState({ kind: 'loading', phase: 'fallback', queuePosition: 0 });
    }
    const pending =
      offThread === null
        ? inspectGcodeOnMainThread(source, controller.signal)
        : offThread.then((result) => ({ result, source }));
    void pending.then(
      (completion) => {
        if (isCurrent) setState({ kind: 'ready', ...completion, mainThreadFallback });
      },
      (error: unknown) => {
        if (!isCurrent) return;
        setState({
          kind: 'error',
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [source]);
  return state;
}

async function inspectGcodeOnMainThread(
  source: GcodeInspectionSource,
  signal: AbortSignal,
): Promise<{
  readonly result: GcodeInspectorWorkerResult;
  readonly source: GcodeInspectionSource;
}> {
  throwIfAborted(signal);
  const text = source.kind === 'text' ? source.text : await source.blob.text();
  throwIfAborted(signal);
  return {
    result: inspectGcodeText(text),
    source: source.kind === 'text' ? source : { kind: 'text', text },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('G-code Inspector request cancelled');
  error.name = 'AbortError';
  throw error;
}
