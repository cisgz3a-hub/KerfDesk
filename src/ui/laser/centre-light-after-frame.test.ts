import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../state/store';
import { centreLightAfterFrameWanted } from './centre-selection-light';

const original = useStore.getState();

afterEach(() => {
  useStore.setState({ project: original.project, jobPlacement: original.jobPlacement });
});

function marlinLight(
  dialectId: 'marlin-fan' | 'marlin-inline',
  onCommand: string,
  offCommand: string,
): void {
  useStore.setState({
    project: {
      ...original.project,
      machine: { kind: 'laser' },
      device: {
        ...original.project.device,
        controllerKind: 'marlin',
        gcodeDialect: { dialectId },
        positioningLight: { onCommand, offCommand, offsetXmm: 0, offsetYmm: 0, afterFrame: true },
      },
    },
    jobPlacement: { ...original.jobPlacement, startFrom: 'absolute' },
  });
}

describe('Centre & LED after Frame on Marlin fan-mosfet lasers', () => {
  it('never switches an M106/M107 "light" on after Frame when fan commands fire the laser', () => {
    marlinLight('marlin-fan', 'M106 P1 S255', 'M107 P1');
    expect(centreLightAfterFrameWanted()).toBe(false);
  });

  it('still finishes Frame with a documented accessory light on the same profile', () => {
    marlinLight('marlin-fan', 'M355 S1', 'M355 S0');
    expect(centreLightAfterFrameWanted()).toBe(true);
  });
});
