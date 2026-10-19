import { afterEach, describe, expect, it } from 'vitest';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import { useStore } from './store';

afterEach(() => useStore.setState({ project: originalProject }));
const families = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const;

describe('positioning light with a captured work-coordinate target', () => {
  it.each(
    families.flatMap((kind) => [false, true].map((reportInches) => ({ kind, reportInches }))),
  )(
    '$kind settles direct work coordinates with reportInches=$reportInches',
    async ({ kind, reportInches }) => {
      const h = harness(kind, undefined, { workOnly: true, reportInches });
      const frame = {
        kind: 'ready',
        controller: framedRunControllerSnapshot(h.get()),
        candidate: {
          preparedStart: { jobOrigin: { startFrom: 'verified-origin', anchor: 'front-left' } },
        },
      } as unknown as FramedRunPermit;
      h.set({ framedRun: frame, completedFrame: frame });
      await h.actions.centrePositioningLight(12.7, 25.4, 1200, undefined, 'work');
      const lines = h.writes.join('');
      expect(lines).toMatch(/(?:\$J=|G0 |G1 )[^\n]*X12.7[^\n]*Y25.4/);
      expect(h.get().statusReport?.mPos).toBeNull();
      expect(h.get().wcoCache).toBeNull();
      expect(h.get().positioningLightEnabled).toBe(true);
      expect(h.get().completedFrame?.candidate).toBe(frame.candidate);
      expect(h.get().controllerOperation).toBeNull();
      expect(h.stop).not.toHaveBeenCalled();
    },
  );

  it('requires a direct work report before moving and never treats native position as work', async () => {
    const h = harness();
    await expect(h.actions.centrePositioningLight(10, 20, 1200, undefined, 'work')).rejects.toThrow(
      'captured coordinate frame',
    );
    expect(h.hasMoved()).toBe(false);
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('contains travel and leaves the LED off if the final direct work report disappears', async () => {
    const h = harness('grbl-v1.1', undefined, { workOnly: true });
    h.after((line) => {
      if (line.startsWith('$J=')) h.reportWorkOnly(false);
    });
    await expect(h.actions.centrePositioningLight(10, 20, 1200, undefined, 'work')).rejects.toThrow(
      'did not reach',
    );
    expect(h.hasMoved()).toBe(true);
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.writes.join('')).not.toContain(h.mapping.onCommand);
  });
});
