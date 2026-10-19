import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  useLaserStore.setState({ safetyNotice: null });
  resetStore();
});

describe('WorkspaceSafetyNotice', () => {
  it('renders nothing until the store raises a notice', () => {
    expect(canvasHost.childElementCount).toBe(0);
  });

  it('floats a failed write over the canvas and keeps it out of the machine toolbar', () => {
    act(() =>
      useLaserStore.setState({
        safetyNotice: { kind: 'write-failed', action: 'jog', message: 'Jog write failed.' },
      }),
    );

    expect(toolbarHost.querySelector('[role="alert"]')).toBeNull();
    const alert = canvasHost.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Controller write failed');
    expect(alert?.textContent).toContain('I made the machine safe');
    // Its stylesheet floats it over the canvas, so it takes no layout space.
    const toast = alert?.parentElement;
    expect(toast?.className).toBe('lf-safety-notice-toast');
    expect(toast?.parentElement?.className).toBe('lf-safety-notice-anchor');
  });
});
