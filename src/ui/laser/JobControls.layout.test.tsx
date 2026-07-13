import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    statusReport: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('JobControls action hierarchy', () => {
  it('places Frame and Start before placement and origin details', async () => {
    const view = await renderControls();
    try {
      expect(precedes(button(view.host, 'Frame'), startFrom(view.host))).toBe(true);
      expect(precedes(button(view.host, 'Start job'), button(view.host, 'Set origin here'))).toBe(
        true,
      );
    } finally {
      await view.unmount();
    }
  });

  it('places Cancel frame before placement details while framing', async () => {
    useLaserStore.setState({
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: false,
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderControls();
    try {
      expect(precedes(button(view.host, 'Cancel frame'), startFrom(view.host))).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('places Pause and Stop before placement details during a job', async () => {
    useLaserStore.setState({
      streamer: {
        status: 'streaming',
        streamingMode: 'char-counted',
        queued: [],
        queueIndex: 0,
        inFlight: [{ line: 'G1 X1 S100\n', bytes: 11 }],
        inFlightBytes: 11,
        completed: 0,
        total: 1,
        rxBufferBytes: 120,
        toolChangePause: false,
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const view = await renderControls();
    try {
      expect(precedes(button(view.host, 'Pause'), startFrom(view.host))).toBe(true);
      expect(precedes(button(view.host, 'Stop'), startFrom(view.host))).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});

async function renderControls(): Promise<{
  readonly host: HTMLDivElement;
  readonly unmount: () => Promise<void>;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
  });
  return {
    host,
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

function startFrom(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Start from"]');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Start from control not rendered');
  return select;
}

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
