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
  // Maintainer-directed order for the no-homing workflow: placement (job
  // anchor) first, origin directly under it, the alternate positioning guide
  // below those, and the job actions last.
  it('orders the rail placement, then origin, then position guide, then job actions', async () => {
    const view = await renderControls();
    try {
      expect(precedes(startFrom(view.host), button(view.host, 'Set origin here'))).toBe(true);
      expect(
        precedes(
          button(view.host, 'Set origin here'),
          button(view.host, 'Release motors to move by hand'),
        ),
      ).toBe(true);
      expect(
        precedes(
          button(view.host, 'Release motors to move by hand'),
          button(view.host, 'Start job'),
        ),
      ).toBe(true);
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

  it('keeps passive frame status with the job cluster while framing', async () => {
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
      // Placement leads the rail, so run status renders below the actions
      // that caused it — directly under Start/Frame, not above placement.
      expect(
        precedes(
          button(view.host, 'Start job'),
          elementContaining(view.host, 'Frame motion is active'),
        ),
      ).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  it('keeps run actions out of the rail while placing safety detail with the job cluster', async () => {
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
        precedes(
          button(view.host, 'Start job'),
          elementContaining(view.host, 'Pause is feed hold only'),
        ),
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
