import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type Origin } from '../../core/devices';
import { nativeBedFrame, bedPointToNative } from '../../core/devices/native-bed-frame';
import { capturedMachinePointToScene } from '../laser/print-cut-capture-frame';
import { useStore } from './store';
import { resolvePrintCutRegistration, usePrintCutSessionStore } from './print-cut-session-store';

const project = {
  ...createProject(),
  printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
};

describe('print-and-cut session trust', () => {
  beforeEach(() => usePrintCutSessionStore.getState().clear());

  it('requires both captures from the current position epoch', () => {
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: 100, y: 50 }, 3);
    session.capture('second', { x: 120, y: 50 }, 3);
    expect(resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState()).kind).toBe(
      'valid',
    );
    expect(resolvePrintCutRegistration(project, 4, usePrintCutSessionStore.getState())).toEqual({
      kind: 'invalid',
      reason: 'Machine position trust changed. Capture both points again.',
    });
  });

  it('records whether the head or the camera placed each point, and solves both alike', () => {
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: 100, y: 50 }, 3, 'bed', 'camera', 'bed');
    session.capture('second', { x: 110, y: 50 }, 3, 'bed', undefined, 'bed');
    const state = usePrintCutSessionStore.getState();
    expect(state.first?.source).toBe('camera');
    expect(state.second?.source).toBeUndefined();
    expect(resolvePrintCutRegistration(project, 3, state, 'bed').kind).toBe('valid');
  });

  it.each([true, false])(
    'does not combine bed camera and unknown-frame head points (camera first: %s)',
    (cameraFirst) => {
      const session = usePrintCutSessionStore.getState();
      const key = '["front-left",400,300,null]';
      session.capture(cameraFirst ? 'first' : 'second', { x: 50, y: 270 }, 3, key, 'camera', 'bed');
      session.capture(
        cameraFirst ? 'second' : 'first',
        { x: -300, y: 570 },
        3,
        key,
        'head',
        'controller-relative',
      );
      expect(
        resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState(), key),
      ).toEqual({
        kind: 'invalid',
        reason:
          'The camera and head captures use different coordinate bases. Capture both points with the same source, or establish the controller-to-bed mapping before mixing sources.',
      });
    },
  );

  it('keeps camera-only registration available without a native mapping', () => {
    const session = usePrintCutSessionStore.getState();
    const key = '["front-left",400,300,null]';
    session.capture('first', { x: 100, y: 50 }, 3, key, 'camera', 'bed');
    session.capture('second', { x: 110, y: 50 }, 3, key, 'camera', 'bed');
    expect(
      resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState(), key).kind,
    ).toBe('valid');
  });

  it.each<Origin>(['rear-left', 'front-left', 'front-right', 'rear-right', 'center'])(
    'combines camera and mapped head captures on %s without changing scale or position',
    (origin) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 400, bedHeight: 300 };
      const frame = nativeBedFrame(device, { minX: -400, minY: -300, maxX: 0, maxY: 0 });
      if (frame === null) throw new Error('expected native frame');
      const first = { x: 50, y: 80 },
        second = { x: 100, y: 80 };
      const native = bedPointToNative(toMachineCoords(second, device), frame);
      const head = capturedMachinePointToScene({ ...native, z: 0 }, device, false, frame);
      if (head === null) throw new Error('expected mapped head point');
      const session = usePrintCutSessionStore.getState();
      session.capture('first', first, 3, 'mapped', 'camera', 'bed');
      session.capture('second', head, 3, 'mapped', 'head', 'bed');
      const resolved = resolvePrintCutRegistration(
        { ...project, device, printAndCutTargets: { first, second } },
        3,
        usePrintCutSessionStore.getState(),
        'mapped',
      );
      expect(resolved).toEqual({
        kind: 'valid',
        transform: { scale: 1, rotationRad: 0, translation: { x: 0, y: 0 } },
      });
    },
  );

  it('stores and removes design targets as undoable project edits', () => {
    const initial = createProject();
    useStore.setState({ project: initial, undoStack: [], redoStack: [], dirty: false });
    useStore.getState().setPrintAndCutTargets(project.printAndCutTargets);
    expect(useStore.getState().project.printAndCutTargets).toEqual(project.printAndCutTargets);
    expect(useStore.getState().undoStack).toEqual([initial]);
    useStore.getState().setPrintAndCutTargets(null);
    expect(useStore.getState().project.printAndCutTargets).toBeUndefined();
  });
  it('invalidates mixed or stale coordinate mappings without rejecting a stable controller-relative pair', () => {
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: -300, y: 200 }, 3, 'controller-relative');
    session.capture('second', { x: -290, y: 200 }, 3, 'controller-relative');
    expect(
      resolvePrintCutRegistration(
        project,
        3,
        usePrintCutSessionStore.getState(),
        'controller-relative',
      ).kind,
    ).toBe('valid');
    expect(
      resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState(), 'bed').kind,
    ).toBe('invalid');
    session.capture('second', { x: 68, y: 68 }, 3, 'bed');
    expect(resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState()).kind).toBe(
      'invalid',
    );
  });
});
