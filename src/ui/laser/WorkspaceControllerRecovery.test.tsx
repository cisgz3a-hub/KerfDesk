import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { MachineConnectionToolbar } from './MachineConnectionToolbar';
import { WorkspaceSafetyNotice } from './WorkspaceSafetyNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: async () => [],
  pickFileForSave: async () => null,
  serial: { isSupported: () => true, requestPort: async () => null },
};

const MESSAGE = 'No controller response was received. Check the cable and controller, then retry.';

// Separate hosts stand in for the top bar and the canvas accessories.
let toolbarHost: HTMLDivElement;
let canvasHost: HTMLDivElement;
let rootHost: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    motionOperation: null,
    controllerOperation: null,
    safetyNotice: null,
  });
  toolbarHost = document.createElement('div');
  canvasHost = document.createElement('div');
  rootHost = document.createElement('div');
  document.body.append(toolbarHost, canvasHost, rootHost);
  root = createRoot(rootHost);
  act(() =>
    root.render(
      <PlatformProvider adapter={platform}>
        {createPortal(<MachineConnectionToolbar />, toolbarHost)}
        {createPortal(<WorkspaceSafetyNotice />, canvasHost)}
      </PlatformProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  toolbarHost.remove();
  canvasHost.remove();
  rootHost.remove();
  resetStore();
});

/** A failed settings read on a connected controller. `answering` keeps its
 * status replies fresh; otherwise it has stopped answering. */
function failRead(options: { readonly answering: boolean; readonly epoch?: number }): void {
  const epoch = options.epoch ?? 4;
  act(() =>
    useLaserStore.setState({
      connection: { kind: 'connected' },
      controllerSessionEpoch: epoch,
      controllerQualification: { kind: 'failed', epoch, message: `${MESSAGE} (${epoch})` },
      pendingUntrackedAcks: 0,
      statusObservation: null,
      statusResponseObservation: options.answering
        ? { sessionEpoch: epoch, observedAt: Date.now() }
        : null,
    }),
  );
}

function card(): HTMLElement | null {
  return canvasHost.querySelector('[role="alert"][aria-label="Controller recovery"]');
}

function button(name: string): HTMLButtonElement | undefined {
  return [...canvasHost.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.includes(name) === true ||
      candidate.getAttribute('aria-label') === name,
  );
}

// ADR-642: recovery used to wait behind a six-second line beside the
// Laser/CNC switch, so a paused job showed only the safety notice.
describe('WorkspaceControllerRecovery', () => {
  it('opens over the canvas by itself when the controller stops answering', () => {
    failRead({ answering: false });

    expect(card()?.textContent).toContain('Machine stopped answering');
    expect(card()?.textContent).toContain(`${MESSAGE} (4)`);
    expect(button('Reconnect controller')).toBeDefined();
    expect(button('Retry reading controller settings')).toBeDefined();
    expect(toolbarHost.textContent).not.toContain('needs recovery');
    // It announces itself without taking focus from the operator's control.
    expect(document.activeElement).toBe(document.body);
  });

  it('stays quiet for a failed read while the controller still answers', () => {
    failRead({ answering: true });
    expect(canvasHost.childElementCount).toBe(0);
  });

  // One `ok` lost on a settings read leaves a reply owed, so Controller info
  // recommends Reconnect, which ends any paused job. While status replies keep
  // arriving that stays in Controller info and nothing pops up (ADR-611).
  it('stays quiet when a reply is still owed but the controller answers', () => {
    failRead({ answering: true });
    act(() => useLaserStore.setState({ pendingUntrackedAcks: 1 }));
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(true);
    expect(canvasHost.childElementCount).toBe(0);
    expect(toolbarHost.textContent).not.toContain('needs recovery');
  });

  // A status write stuck in a wedged transport stops the poll from writing to
  // the store, so the silence deadline has to be re-read on a timer.
  it('opens once the controller has been silent long enough, with no store writes', () => {
    vi.useFakeTimers();
    try {
      failRead({ answering: true });
      expect(card()).toBeNull();
      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      expect(card()?.textContent).toContain('Machine stopped answering');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays quiet while settings are read after a reset', () => {
    act(() =>
      useLaserStore.setState({
        connection: { kind: 'connected' },
        controllerSessionEpoch: 4,
        controllerQualification: { kind: 'qualifying', epoch: 4, phase: 'reset-cleanup' },
        statusObservation: null,
        statusResponseObservation: null,
      }),
    );
    expect(canvasHost.childElementCount).toBe(0);
  });

  it('folds into a button that stays until the controller recovers', () => {
    failRead({ answering: false });
    act(() => button('Collapse controller recovery')?.click());

    expect(card()).toBeNull();
    const show = button('Machine stopped answering');
    expect(show).toBeDefined();
    expect(document.activeElement).toBe(show);

    // Status writes for the same failure leave it folded.
    failRead({ answering: false });
    expect(card()).toBeNull();

    act(() => show?.click());
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(button('Collapse controller recovery'));

    act(() =>
      useLaserStore.setState({
        controllerQualification: { kind: 'qualified', epoch: 4, settings: 'verified' },
      }),
    );
    expect(canvasHost.childElementCount).toBe(0);
  });

  it('opens again for a new failure after being folded', () => {
    failRead({ answering: false });
    act(() => button('Collapse controller recovery')?.click());
    expect(card()).toBeNull();

    failRead({ answering: false, epoch: 5 });
    expect(card()?.textContent).toContain(`${MESSAGE} (5)`);
  });

  it('sits under the safety notice in the same floating stack', () => {
    act(() =>
      useLaserStore.setState({
        safetyNotice: { kind: 'stream-stalled', message: 'The controller stopped acknowledging.' },
      }),
    );
    failRead({ answering: false });

    const stack = canvasHost.querySelector('.lf-safety-notice-toast');
    const alerts = stack?.querySelectorAll(':scope > [role="alert"]');
    expect(alerts?.length).toBe(2);
    expect(alerts?.[0]?.textContent).toContain('Controller stream stalled');
    expect(alerts?.[1]).toBe(card());
  });

  it('reconnects through the store when asked', () => {
    const connect = vi.fn(async () => undefined);
    useLaserStore.setState({ connect });
    failRead({ answering: false });
    act(() => button('Reconnect controller')?.click());
    expect(connect).toHaveBeenCalledOnce();
  });
});
