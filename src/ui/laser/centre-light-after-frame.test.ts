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
  it.each([
    ['M106 P1 S255', 'M107 P1'],
    ['M355 S1', 'M355 S0'],
  ])('never switches a light %s on after Frame on a fan-mosfet laser', (onCommand, offCommand) => {
    marlinLight('marlin-fan', onCommand, offCommand);
    expect(centreLightAfterFrameWanted()).toBe(false);
  });

  it('still finishes Frame with an accessory light on an inline Marlin profile', () => {
    marlinLight('marlin-inline', 'M355 S1', 'M355 S0');
    expect(centreLightAfterFrameWanted()).toBe(true);
  });
});
