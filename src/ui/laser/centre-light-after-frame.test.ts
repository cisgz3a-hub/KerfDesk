import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobStartMode } from '../../core/job';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import {
  centreLightAfterFrameWanted,
  centreLightOnFramedArtwork,
  centreSelectionLight,
} from './centre-selection-light';

const original = useStore.getState();

afterEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ project: original.project, jobPlacement: original.jobPlacement });
});

function marlinLight(
  dialectId: 'marlin-fan' | 'marlin-inline',
  onCommand: string,
  offCommand: string,
  startFrom: JobStartMode,
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
    jobPlacement: { ...original.jobPlacement, startFrom },
  });
}

describe.each(['absolute', 'user-origin', 'verified-origin', 'current-position'] as const)(
  'Centre & LED on Marlin with %s placement',
  (mode) => {
    it.each([
      ['M106 P1 S255', 'M107 P1'],
      ['M355 S1', 'M355 S0'],
    ])(
      'refuses automatic and chosen-artwork light %s on fan-mosfet',
      async (onCommand, offCommand) => {
        marlinLight('marlin-fan', onCommand, offCommand, mode);
        const centre = vi.spyOn(useLaserStore.getState(), 'centrePositioningLight');
        expect(centreLightAfterFrameWanted()).toBe(false);
        await expect(centreLightOnFramedArtwork()).rejects.toThrow('fan-mosfet');
        await expect(centreSelectionLight(['selected'])).rejects.toThrow('fan-mosfet');
        expect(centre).not.toHaveBeenCalled();
      },
    );

    it('still permits the automatic light on an inline Marlin profile', () => {
      marlinLight('marlin-inline', 'M355 S1', 'M355 S0', mode);
      expect(centreLightAfterFrameWanted()).toBe(true);
    });
  },
);
