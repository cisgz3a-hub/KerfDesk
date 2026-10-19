import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import { useStore } from './store';
import { useLaserStore } from './laser-store';
import { usePrintCutSessionStore } from './print-cut-session-store';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { nativeBedCaptureFrameKey } from './native-bed-frame';
import { currentFrameSpatialSignature } from '../laser/frame-spatial-identity';
import { currentPrintCutOutputRegistration } from '../laser/print-cut-output';

const originalRegistration = usePrintCutSessionStore.getState();
const originalFeatures = useExperimentalLaserFeatures.getState().features;
afterEach(() => {
  useStore.setState({ project: originalProject });
  usePrintCutSessionStore.setState(originalRegistration);
  useExperimentalLaserFeatures.setState({ features: originalFeatures });
});

function registeredHarness() {
  const h = harness();
  const project = {
    ...useStore.getState().project,
    printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
  };
  useStore.setState({ project });
  useExperimentalLaserFeatures.setState({ features: { ...originalFeatures, printAndCut: true } });
  const laser = useLaserStore.getState();
  const key = nativeBedCaptureFrameKey(project.device, laser);
  const epoch = laser.trustedPositionEpoch ?? 0;
  usePrintCutSessionStore.getState().capture('first', { x: 20, y: 30 }, epoch, key);
  usePrintCutSessionStore.getState().capture('second', { x: 30, y: 30 }, epoch, key);
  expect(currentPrintCutOutputRegistration(project)).toBeDefined();
  expect(currentPrintCutOutputRegistration(project)).not.toBeNull();
  const permit = {
    kind: 'ready',
    controller: framedRunControllerSnapshot(h.get()),
    candidate: { preparedStart: { jobOrigin: { startFrom: 'absolute' } } },
  } as unknown as FramedRunPermit;
  h.set({ framedRun: permit, completedFrame: permit });
  return h;
}

describe('external spatial edits while LED Frame proof is stashed', () => {
  it.each(['registration', 'feature'] as const)(
    'latches a %s round trip that changes the canonical Print-and-Cut signature',
    async (store) => {
      const h = registeredHarness();
      const signature = currentFrameSpatialSignature();
      let markers = 0;
      h.after((line) => {
        if (line === h.refs.driver.commands.settleDwell && ++markers === 2) h.hold(line);
      });
      const pending = h.actions.centrePositioningLight(40, 45, 1200);
      const rejected = expect(pending).rejects.toThrow('Artwork or placement changed');
      await vi.waitFor(() => expect(markers).toBe(2));
      if (store === 'registration') {
        const first = usePrintCutSessionStore.getState().first!;
        usePrintCutSessionStore.setState({ first: { ...first, point: { x: 21, y: 30 } } });
        expect(currentFrameSpatialSignature()).not.toBe(signature);
        usePrintCutSessionStore.setState({ first });
      } else {
        const features = useExperimentalLaserFeatures.getState().features;
        useExperimentalLaserFeatures.setState({ features: { ...features, printAndCut: false } });
        expect(currentFrameSpatialSignature()).not.toBe(signature);
        useExperimentalLaserFeatures.setState({ features });
      }
      expect(currentFrameSpatialSignature()).toBe(signature);
      h.hold();
      h.ack(h.refs.driver.commands.settleDwell);
      await rejected;
      expect(h.get().completedFrame).toBeNull();
      expect(h.get().framedRun).toBeNull();
      expect(h.get().positioningLightEnabled).toBe(false);
      expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
      expect(h.stop).toHaveBeenCalledOnce();
    },
  );
});
