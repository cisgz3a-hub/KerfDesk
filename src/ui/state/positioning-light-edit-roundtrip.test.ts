import { afterEach, describe, expect, it, vi } from 'vitest';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { framedRunControllerSnapshot, type FramedRunPermit } from './framed-run';
import { useStore } from './store';
import { createLayer, IDENTITY_TRANSFORM } from '../../core/scene';
import { currentFrameSpatialSignature } from '../laser/frame-spatial-identity';
import { usePrintCutSessionStore } from './print-cut-session-store';
import { useExperimentalLaserFeatures } from './experimental-laser-features';

const originalHistory = {
  projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
  selectedObjectId: useStore.getState().selectedObjectId,
  additionalSelectedIds: useStore.getState().additionalSelectedIds,
  undoStack: useStore.getState().undoStack,
  redoStack: useStore.getState().redoStack,
  pendingUndo: useStore.getState().pendingUndo,
};
afterEach(() => {
  useStore.setState({ project: originalProject, ...originalHistory });
});

function artworkHarness() {
  const h = harness();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          {
            kind: 'shape',
            id: 'artwork',
            spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
            bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
            transform: IDENTITY_TRANSFORM,
            color: '#000000',
            paths: [],
          },
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
      },
    },
    selectedObjectId: 'artwork',
    additionalSelectedIds: new Set(),
  });
  return h;
}

function completeFrame(h: ReturnType<typeof harness>): FramedRunPermit {
  const permit = {
    kind: 'ready',
    completedStatusSequence: h.get().statusSequence,
    controller: framedRunControllerSnapshot(h.get()),
    candidate: { preparedStart: { jobOrigin: { startFrom: 'absolute' } } },
  } as unknown as FramedRunPermit;
  h.set({ framedRun: permit, completedFrame: permit });
  return permit;
}

function editThenUndo(): void {
  const project = useStore.getState().project;
  useStore.setState({ undoStack: [], redoStack: [], pendingUndo: null });
  useStore.getState().nudgeSelection(5, 0);
  expect(useStore.getState().project).not.toBe(project);
  useStore.getState().undo();
  expect(useStore.getState().project).toBe(project);
}

describe('one-way edit evidence across positioning light waits', () => {
  it('never restores Frame after an edit and Undo while the jog settlement ACK is held', async () => {
    const h = artworkHarness();
    completeFrame(h);
    let markers = 0;
    h.after((line) => {
      if (line === h.refs.driver.commands.settleDwell && ++markers === 2) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const rejected = expect(pending).rejects.toThrow('Artwork or placement changed');
    await vi.waitFor(() => expect(markers).toBe(2));
    expect(h.hasMoved()).toBe(true);
    expect(h.get().completedFrame).toBeNull();
    editThenUndo();
    h.hold();
    h.ack(h.refs.driver.commands.settleDwell);
    await rejected;
    expect(h.get().framedRun).toBeNull();
    expect(h.get().completedFrame).toBeNull();
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    expect(h.stop).toHaveBeenCalledOnce();
  });

  it('rejects an edit and Undo during the initial beam-off wait before any movement', async () => {
    const h = artworkHarness();
    completeFrame(h);
    h.hold('M5');
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const rejected = expect(pending).rejects.toThrow('Artwork or placement changed');
    await vi.waitFor(() => expect(h.writes).toContain('M5\n'));
    editThenUndo();
    h.hold();
    h.ack('M5');
    await rejected;
    expect(h.hasMoved()).toBe(false);
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.writes).not.toContain(`${h.mapping.onCommand}\n`);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('retains Frame and lights the LED after process power, speed and layer name edits during settlement', async () => {
    const h = artworkHarness();
    const permit = completeFrame(h);
    const signature = currentFrameSpatialSignature();
    let markers = 0;
    h.after((line) => {
      if (line === h.refs.driver.commands.settleDwell && ++markers === 2) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    await vi.waitFor(() => expect(markers).toBe(2));
    const layer = useStore.getState().project.scene.layers[0]!;
    useStore.getState().setLayerParam(layer.id, {
      power: layer.power + 1,
      speed: layer.speed + 10,
      name: 'Edited process',
    });
    expect(currentFrameSpatialSignature()).toBe(signature);
    h.hold();
    h.ack(h.refs.driver.commands.settleDwell);
    await pending;
    expect(h.get().completedFrame?.candidate).toBe(permit.candidate);
    expect(h.get().framedRun).toBe(h.get().completedFrame);
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('rejects a replacement document during settlement even with identical geometry', async () => {
    const h = artworkHarness();
    completeFrame(h);
    let markers = 0;
    h.after((line) => {
      if (line === h.refs.driver.commands.settleDwell && ++markers === 2) h.hold(line);
    });
    const pending = h.actions.centrePositioningLight(40, 45, 1200);
    const rejected = expect(pending).rejects.toThrow('Artwork or placement changed');
    await vi.waitFor(() => expect(markers).toBe(2));
    useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
    h.hold();
    h.ack(h.refs.driver.commands.settleDwell);
    await rejected;
    expect(h.get().completedFrame).toBeNull();
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('disposes the scoped edit observer after success and after a failed handoff', async () => {
    const originalSubscribe = useStore.subscribe;
    const originalRegistrationSubscribe = usePrintCutSessionStore.subscribe;
    const originalFeatureSubscribe = useExperimentalLaserFeatures.subscribe;
    const disposed = vi.fn();
    const registrationDisposed = vi.fn();
    const featureDisposed = vi.fn();
    const subscribe = vi.spyOn(useStore, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = originalSubscribe(listener);
      return () => {
        disposed();
        unsubscribe();
      };
    });
    const registrationSubscribe = vi
      .spyOn(usePrintCutSessionStore, 'subscribe')
      .mockImplementation((listener) => {
        const unsubscribe = originalRegistrationSubscribe(listener);
        return () => {
          registrationDisposed();
          unsubscribe();
        };
      });
    const featureSubscribe = vi
      .spyOn(useExperimentalLaserFeatures, 'subscribe')
      .mockImplementation((listener) => {
        const unsubscribe = originalFeatureSubscribe(listener);
        return () => {
          featureDisposed();
          unsubscribe();
        };
      });
    try {
      const h = artworkHarness();
      await h.actions.centrePositioningLight(40, 45, 1200);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(registrationDisposed).toHaveBeenCalledTimes(1);
      expect(featureDisposed).toHaveBeenCalledTimes(1);
      // A disposed observer must not couple a completed move to future edits.
      editThenUndo();
      expect(h.get().positioningLightEnabled).toBe(true);
      h.fail('M5');
      await expect(h.actions.centrePositioningLight(50, 55, 1200)).rejects.toThrow('handoff');
      expect(subscribe).toHaveBeenCalledTimes(2);
      expect(disposed).toHaveBeenCalledTimes(2);
      expect(registrationDisposed).toHaveBeenCalledTimes(2);
      expect(featureDisposed).toHaveBeenCalledTimes(2);
    } finally {
      subscribe.mockRestore();
      registrationSubscribe.mockRestore();
      featureSubscribe.mockRestore();
    }
  });
});
