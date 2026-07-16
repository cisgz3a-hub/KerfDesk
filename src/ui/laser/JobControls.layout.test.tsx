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
  // Maintainer-directed order for the no-homing workflow: positioning controls
  // (origin, position-job guide) sit directly under the jog pad, job actions
  // below them, placement details last.
  it('places origin controls before the job actions and placement details', async () => {
    const view = await renderControls();
    try {
      expect(precedes(button(view.host, 'Set origin here'), button(view.host, 'Start job'))).toBe(
        true,
      );
      expect(precedes(button(view.host, 'Frame'), startFrom(view.host))).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('leads the job cluster with Start job, then Frame, then Home', async () => {
    const view = await renderControls();
    try {
      expect(precedes(button(view.host, 'Start job'), button(view.host, 'Frame'))).toBe(true);
      expect(precedes(button(view.host, 'Frame'), button(view.host, 'Home'))).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('places passive frame status before placement details while framing', async () => {
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
      expect(
        precedes(elementContaining(view.host, 'Frame motion is active'), startFrom(view.host)),
      ).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('keeps run actions out of the rail while placing safety detail before placement', async () => {
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
      expect(
        precedes(elementContaining(view.host, 'Pause is feed hold only'), startFrom(view.host)),
      ).toBe(true);
      const labels = [...view.host.querySelectorAll('button')].map(
        (candidate) => candidate.textContent,
      );
      expect(labels).not.toContain('Pause');
      expect(labels).not.toContain('ABORT');
      expect(labels).not.toContain('ABORT JOB');
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

function elementContaining(host: HTMLElement, text: string): HTMLElement {
  const match = [...host.querySelectorAll('span')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(match instanceof HTMLElement)) throw new Error(`Text not rendered: ${text}`);
  return match;
}

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
