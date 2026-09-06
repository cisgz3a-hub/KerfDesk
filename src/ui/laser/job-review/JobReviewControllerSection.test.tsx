import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { resetStore } from '../../state/test-helpers';
import { JobReviewControllerSection } from './JobReviewControllerSection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let laserState: ReturnType<typeof useLaserStore.getState>;

beforeEach(() => {
  resetStore();
  laserState = useLaserStore.getState();
  useLaserStore.setState({ connection: { kind: 'connected' }, controllerSettings: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetStore();
  useLaserStore.setState(laserState, true);
});

function projectWithSpindle(maxRpm: number): Project {
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: maxRpm },
    },
  };
}

function renderProject(project: Project): void {
  act(() => {
    useStore.setState({ project });
    root.render(<JobReviewControllerSection machineKind={project.machine?.kind ?? 'laser'} />);
  });
}

function sMaxValue(): Element | null {
  const term = [...host.querySelectorAll('dt')].find((node) => node.textContent === 'S max $30');
  return term?.nextElementSibling ?? null;
}

describe('JobReviewControllerSection spindle scale ownership', () => {
  it.each([
    [12000, '12000', false],
    [1000, '1000 — profile expects 12000', true],
  ])('compares CNC spindle maximum with live S maximum %s', (live, text, isWarning) => {
    useLaserStore.setState({ controllerSettings: { maxPowerS: live } });
    renderProject(projectWithSpindle(12000));
    expect(sMaxValue()?.textContent).toBe(text);
    expect(sMaxValue()?.getAttribute('style')?.includes('--lf-warning-fg')).toBe(isWarning);
  });

  it('keeps the laser scale when switching modes and follows live CNC ceiling edits', () => {
    useLaserStore.setState({ controllerSettings: { maxPowerS: 1000 } });
    renderProject(createProject());
    expect(sMaxValue()?.textContent).toBe('1000');
    renderProject(projectWithSpindle(12000));
    expect(sMaxValue()?.textContent).toBe('1000 — profile expects 12000');
    act(() => useStore.setState({ project: projectWithSpindle(6000) }));
    expect(sMaxValue()?.textContent).toBe('1000 — profile expects 6000');
    renderProject(createProject());
    expect(sMaxValue()?.textContent).toBe('1000');
  });

  it('follows a live controller settings refresh', () => {
    useLaserStore.setState({ controllerSettings: { maxPowerS: 1000 } });
    renderProject(projectWithSpindle(12000));
    act(() => useLaserStore.setState({ controllerSettings: { maxPowerS: 12000 } }));
    expect(sMaxValue()?.textContent).toBe('12000');
  });

  it('does not invent a live $30 when the setting is missing', () => {
    useLaserStore.setState({ controllerSettings: {} });
    renderProject(projectWithSpindle(12000));
    expect(sMaxValue()?.textContent).toBe('Unknown');
    expect(sMaxValue()?.getAttribute('style')).toContain('--lf-warning-fg');
  });

  it('keeps unread and disconnected controller settings unavailable', () => {
    renderProject(projectWithSpindle(12000));
    expect(host.textContent).toContain('Not read this session');
    expect(sMaxValue()).toBeNull();
    act(() => useLaserStore.setState({ connection: { kind: 'disconnected' } }));
    expect(host.textContent).toContain('Not connected');
    expect(sMaxValue()).toBeNull();
  });
});
