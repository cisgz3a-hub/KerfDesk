import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useStore } from '../state/store';
import { PrintAndCutDialogHost } from './PrintAndCutDialogHost';
import { currentPrintCutOutputRegistration } from './print-cut-output';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      device: { ...base.device, homing: { ...base.device.homing, enabled: false } },
      printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
    },
  });
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    trustedPositionEpoch: 4,
    homingState: 'unknown',
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 20, y: 30, z: 0 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: null,
    },
  });
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.setState((state) => ({
    features: { ...state.features, printAndCut: true },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = null;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
});

describe('Print-and-Cut without homing', () => {
  it('allows epoch-bound machine point capture while connected and Idle', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<PrintAndCutDialogHost onClose={() => undefined} />);
    });

    const captureButtons = [...host.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Capture head'),
    );
    expect(captureButtons).toHaveLength(2);
    expect(captureButtons.every((button) => !button.disabled)).toBe(true);
  });

  it('accepts registration captures only from the current position epoch', () => {
    const project = useStore.getState().project;
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: 20, y: 30 }, 4);
    session.capture('second', { x: 30, y: 30 }, 4);

    expect(currentPrintCutOutputRegistration(project)).toMatchObject({
      scale: 1,
      translation: { x: 20, y: 30 },
    });
    useLaserStore.setState({ trustedPositionEpoch: 5 });
    expect(currentPrintCutOutputRegistration(project)).toBeNull();
  });
});
