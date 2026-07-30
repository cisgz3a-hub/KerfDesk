import { useEffect, useState } from 'react';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { inspectGcodeText } from './gcode-inspector-parse';
import { inspectGcodeOffThread } from './gcode-inspector-worker-client';
import type { GcodeInspectorWorkerResult } from './gcode-inspector-worker-protocol';

export type InspectionState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly phase: 'queued' | 'reading' | 'parsing';
      readonly queuePosition: number;
      readonly bytesRead?: number;
      readonly totalBytes?: number;
    }
  | { readonly kind: 'ready'; readonly result: GcodeInspectorWorkerResult }
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
    const pending =
      offThread ??
      (source.kind === 'text'
        ? Promise.resolve(inspectGcodeText(source.text))
        : Promise.reject(new Error('G-code Inspector worker unavailable')));
    void pending.then(
      (result) => {
        if (isCurrent) setState({ kind: 'ready', result });
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
