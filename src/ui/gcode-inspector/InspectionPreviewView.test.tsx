import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { GcodeInspectorDialog } from './GcodeInspectorDialog';
import { inspectGcodeText } from './gcode-inspector-parse';
import { resetGcodeInspectorWorkerForTests } from './gcode-inspector-worker-client';
import type {
  GcodeInspectorWorkerRequest,
  GcodeInspectorWorkerResponse,
} from './gcode-inspector-worker-protocol';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAM = ['G21 G90', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'G1 X20 Y10'].join('\n');

class StubWorker {
  static latest: StubWorker | null = null;
  onmessage: ((event: MessageEvent<GcodeInspectorWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: GcodeInspectorWorkerRequest[] = [];

  constructor() {
    StubWorker.latest = this;
  }

  postMessage(request: GcodeInspectorWorkerRequest): void {
    this.posted.push(request);
  }

  readonly terminate = vi.fn();

  reply(response: GcodeInspectorWorkerResponse): void {
    act(() => {
      this.onmessage?.({ data: response } as MessageEvent<GcodeInspectorWorkerResponse>);
    });
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  StubWorker.latest = null;
  vi.stubGlobal('Worker', StubWorker);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  resetGcodeInspectorWorkerForTests();
  useUiStore.setState({ modalDepth: 0 });
  vi.unstubAllGlobals();
});

function text(): string {
  return container?.textContent ?? '';
}

describe('Inspector preview while the worker reads (ADR-485)', () => {
  it('keeps the sentence until moves arrive, then shows them until the program is ready', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <GcodeInspectorDialog
          programName="big.nc"
          source={{ kind: 'text', text: PROGRAM }}
          machineKind="laser"
          onClose={() => undefined}
        />,
      );
    });
    const worker = StubWorker.latest;
    const id = worker?.posted[0]?.id ?? -1;
    if (worker === null) throw new Error('no worker');
    worker.reply({ id, kind: 'progress', phase: 'parsing' });
    expect(text()).toContain('Building preview in worker… Close to cancel.');
    expect(container.querySelector('.gcode-viewer-preview')).toBeNull();

    const solid = new Float32Array([10, 0, 0, 20, 0, 0]);
    const travel = new Float32Array([0, 0, 0, 10, 0, 0]);
    worker.reply({ id, kind: 'preview', chunk: { solid, travel, moves: 2, fraction: 0.4 } });
    expect(container.querySelector('.gcode-viewer-preview')).not.toBeNull();
    expect(text()).toContain('Building preview in worker… Close to cancel.');
    expect(text()).toContain('2 moves read · 40% of the file');

    worker.reply({ id, kind: 'progress', phase: 'timing' });
    expect(text()).toContain('Timing the moves in worker… Close to cancel.');
    expect(text()).toContain('2 moves read');

    worker.reply({ id, kind: 'complete', result: inspectGcodeText(PROGRAM) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('.gcode-viewer-preview')).toBeNull();
    expect(text()).toContain('3 shown segments');
  });
});
