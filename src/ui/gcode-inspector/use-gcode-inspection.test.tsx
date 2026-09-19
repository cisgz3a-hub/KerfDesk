import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { useGcodeInspection, type InspectionState } from './use-gcode-inspection';

vi.mock('./gcode-inspector-worker-client', () => ({ inspectGcodeOffThread: () => null }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: InspectionState = { kind: 'idle' };

function Probe(props: { readonly source: GcodeInspectionSource }): null {
  latest = useGcodeInspection(props.source);
  return null;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = { kind: 'idle' };
});

describe('Inspector main-thread fallback context', () => {
  it.each(['text', 'blob'] as const)(
    'keeps laser context and source bytes for %s input',
    async (kind) => {
      const text = 'M4 S0\nG1 X3 F1500\nX23 S300\nX26 S0';
      const source: GcodeInspectionSource =
        kind === 'text'
          ? { kind, text, machineKind: 'laser' }
          : { kind, blob: { text: async () => text } as Blob, machineKind: 'laser' };
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      await act(async () => root?.render(<Probe source={source} />));
      const state = latest as InspectionState;
      expect(state.kind).toBe('ready');
      if (state.kind !== 'ready' || state.result.parsed.kind !== 'ok')
        throw new Error('expected parsed fallback');
      expect(state.mainThreadFallback).toBe(true);
      expect(state.result.parsed.model.stats.cutMm).toBe(20);
      expect(state.result.parsed.model.stats.travelMm).toBe(6);
      expect(state.source).toMatchObject({ kind: 'text', text, machineKind: 'laser' });
    },
  );
});
