import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../../core/scene';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { SetupStep } from './AlignWizardSteps';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().newProject();
  useCameraStore.setState({ confirmedPositionEpoch: null });
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    homingState: 'unknown',
    trustedPositionEpoch: 0,
  });
});

describe('alignment marker burn setup', () => {
  it('does not pre-guard the marker Frame when a homing profile is not homed', () => {
    renderSetup({ homingEnabled: true, trustedPositionEpoch: 8, confirmedPositionEpoch: null });

    expect(burnButton().disabled).toBe(false);
    expect(host.textContent).not.toContain('Home the machine');
  });

  it('does not add manual position confirmation before the marker Frame', () => {
    renderSetup({ homingEnabled: false, trustedPositionEpoch: 8, confirmedPositionEpoch: null });

    expect(burnButton().disabled).toBe(false);
    expect(host.textContent).not.toContain('Confirm bed coordinates');
  });

  it('keeps the factual connection precondition', () => {
    renderSetup({
      connected: false,
      homingEnabled: true,
      trustedPositionEpoch: 8,
      confirmedPositionEpoch: null,
    });

    expect(burnButton().disabled).toBe(true);
    expect(host.textContent).toContain('Connect the machine to burn');
  });
});

function renderSetup(options: {
  readonly connected?: boolean;
  readonly homingEnabled: boolean;
  readonly trustedPositionEpoch: number;
  readonly confirmedPositionEpoch: number | null;
}): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        homing: { ...project.device.homing, enabled: options.homingEnabled },
      },
    },
  });
  useCameraStore.setState({ confirmedPositionEpoch: options.confirmedPositionEpoch });
  useLaserStore.setState({
    connection: { kind: options.connected === false ? 'disconnected' : 'connected' },
    homingState: 'unknown',
    trustedPositionEpoch: options.trustedPositionEpoch,
  });
  act(() => root.render(<SetupStep note={null} />));
}

function burnButton(): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Burn markers',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Burn markers button missing');
  return button;
}
