import { beforeEach, describe, expect, it } from 'vitest';
import { generateFocusTest } from '../../core/job/focus-test';
import { createLayer, createLayerSubLayer } from '../../core/scene';
import { fingerprintGcode } from '../../core/recovery';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resolveJobPlacement, runtimeCoordinatePreparationOptions } from '../job-placement';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { buildLaserResumeProgram } from './laser-resume-program';

beforeEach(() => {
  installFrameOnceProject();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: generateFocusTest({
        steps: 3,
        minOffsetMm: -1,
        maxOffsetMm: 1,
        lineLengthMm: 20,
        spacingMm: 3,
        speed: 1200,
        power: 10,
        travelFeedMmPerMin: 300,
      }),
    },
  }));
});

describe('Focus Test execution and Frame identity', () => {
  it('retains Frame when an unselected Focus operation changes', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            ...state.project.scene.layers,
            createLayer({ id: 'ordinary', color: '#123456' }),
          ],
          objects: [
            ...state.project.scene.objects,
            { ...state.project.scene.objects[0]!, id: 'ordinary-line', operationIds: ['ordinary'] },
          ],
        },
      },
      selectedObjectId: 'ordinary-line',
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    }));
    const spatial = currentFrameSpatialSignature();
    useStore.getState().setLayerParam('focus-test-1', {
      focusTest: { offsetMm: -2, travelFeedMmPerMin: 450 },
    });
    expect(currentFrameSpatialSignature()).toBe(spatial);
  });
  it('binds only the selected Focus sample offset while ignoring its travel feed', () => {
    useStore.setState({
      selectedObjectId: 'focus-test-1-line',
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    });
    const spatial = currentFrameSpatialSignature();
    useStore.getState().setLayerParam('focus-test-2', {
      focusTest: { offsetMm: 2, travelFeedMmPerMin: 300 },
    });
    expect(currentFrameSpatialSignature()).toBe(spatial);
    useStore.getState().setLayerParam('focus-test-1', {
      focusTest: { offsetMm: -1, travelFeedMmPerMin: 450 },
    });
    expect(currentFrameSpatialSignature()).toBe(spatial);
    useStore.getState().setLayerParam('focus-test-1', {
      focusTest: { offsetMm: -2, travelFeedMmPerMin: 450 },
    });
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });
  it('ignores offsets on enabled Focus layers after their artwork is deleted', () => {
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [] } },
    }));
    const spatial = currentFrameSpatialSignature();
    useStore.getState().setLayerParam('focus-test-1', {
      focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 },
    });
    expect(currentFrameSpatialSignature()).toBe(spatial);
  });
  it.each(['point', 'disabled', 'zero-power'] as const)(
    'retains Frame when the Focus offset on %s artwork cannot change output',
    (kind) => {
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            layers: state.project.scene.layers.map((layer, index) =>
              index !== 0
                ? layer
                : {
                    ...layer,
                    output: kind !== 'disabled',
                    power: kind === 'zero-power' ? 0 : layer.power,
                  },
            ),
            objects: state.project.scene.objects.map((object, index) => {
              if (
                index !== 0 ||
                object.kind !== 'imported-svg' ||
                !['point', 'collapsed'].includes(kind)
              )
                return object;
              return {
                ...object,
                paths: object.paths.map((path) => ({
                  ...path,
                  polylines: [
                    {
                      closed: false,
                      points:
                        kind === 'point'
                          ? [{ x: 10, y: 10 }]
                          : [
                              { x: 10, y: 10 },
                              { x: 10.0001, y: 10 },
                            ],
                    },
                  ],
                })),
              };
            }),
          },
        },
      }));
      const spatial = currentFrameSpatialSignature();
      const before = emitGcode(useStore.getState().project).gcode;
      useStore.getState().setLayerParam('focus-test-1', {
        focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 },
      });
      expect(emitGcode(useStore.getState().project).gcode).toBe(before);
      expect(currentFrameSpatialSignature()).toBe(spatial);
    },
  );
  it('uses full-source relative placement before deciding whether a tiny Focus stroke contributes', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer, index) => {
            if (index === 0) return layer;
            const { focusTest: _focus, ...ordinary } = layer;
            return ordinary;
          }),
          objects: state.project.scene.objects.map((object, index) => {
            if (object.kind !== 'imported-svg') return object;
            return {
              ...object,
              paths: object.paths.map((path) => ({
                ...path,
                polylines: [
                  {
                    closed: false,
                    points:
                      index === 0
                        ? [
                            { x: 10.0001, y: 10 },
                            { x: 10.0004, y: 10 },
                          ]
                        : [
                            { x: 9.9997, y: 20 },
                            { x: 30, y: 20 },
                          ],
                  },
                ],
              })),
            };
          }),
        },
      },
    }));
    const original = useStore.getState().project;
    const absolute = currentFrameSpatialSignature();
    expect(emitGcode(original).gcode).not.toContain('G1 Z');
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(absolute);
    useStore.setState({
      project: original,
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    const relative = currentFrameSpatialSignature();
    const options = { jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' } } as const;
    expect(emitGcode(original, options).gcode).toContain('G1 Z');
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(relative);
  });

  it('retains potentially meaningful offset intent when live current-position translation is unresolved', () => {
    useStore.setState((state) => ({
      jobPlacement: { startFrom: 'current-position', anchor: 'front-left' },
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.kind !== 'imported-svg'
              ? object
              : {
                  ...object,
                  paths: object.paths.map((path) => ({
                    ...path,
                    polylines: [
                      {
                        closed: false,
                        points: [
                          { x: 10, y: 10 },
                          { x: 10.0001, y: 10 },
                        ],
                      },
                    ],
                  })),
                },
          ),
        },
      },
    }));
    expect(emitGcode(useStore.getState().project).gcode).not.toContain('G1 Z');
    const spatial = currentFrameSpatialSignature();
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });
  it.each([false, true])(
    'binds the parent Focus offset only when its Line subpass emits (enabled=%s)',
    (enabled) => {
      useStore.setState((state) => ({
        selectedObjectId: 'focus-test-1-line',
        outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            layers: state.project.scene.layers.map((layer, index) =>
              index !== 0
                ? { ...layer, output: false }
                : {
                    ...layer,
                    power: 0,
                    subLayers: [
                      createLayerSubLayer(layer, {
                        id: 'powered-child',
                        label: 'Powered child',
                        enabled,
                      }),
                    ],
                  },
            ),
          },
        },
      }));
      const before = emitGcode(useStore.getState().project).gcode;
      expect(before.includes('G1 Z')).toBe(enabled);
      const spatial = currentFrameSpatialSignature();
      useStore
        .getState()
        .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
      const after = emitGcode(useStore.getState().project).gcode;
      if (enabled) {
        expect(after).not.toBe(before);
        expect(currentFrameSpatialSignature()).not.toBe(spatial);
      } else {
        expect(after).toBe(before);
        expect(currentFrameSpatialSignature()).toBe(spatial);
      }
    },
  );
  it('retains offset intent when a fractional live G54 makes an Absolute collapsed edge executable', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer, index) => ({
            ...layer,
            output: index === 0,
          })),
          objects: state.project.scene.objects.map((object, index) =>
            index !== 0 || object.kind !== 'imported-svg'
              ? object
              : {
                  ...object,
                  paths: object.paths.map((path) => ({
                    ...path,
                    polylines: [
                      {
                        closed: false,
                        points: [
                          { x: 10, y: 10 },
                          { x: 10.0001, y: 10 },
                        ],
                      },
                    ],
                  })),
                },
          ),
        },
      },
    }));
    const project = useStore.getState().project;
    const machine = {
      ...useLaserStore.getState(),
      workOriginActive: true,
      wcoCache: { x: -0.00045, y: 0, z: 0 },
    };
    const placement = resolveJobPlacement(useStore.getState().jobPlacement, machine);
    if (!placement.ok) throw new Error('Expected Absolute placement');
    const options = runtimeCoordinatePreparationOptions(project.device, placement, machine);
    expect(options.absoluteProgramOffset?.x).toBeCloseTo(0.00045, 8);
    expect(emitGcode(project).gcode).not.toContain('G1 Z');
    const before = emitGcode(project, options).gcode;
    expect(before).toContain('G1 Z');
    const spatial = currentFrameSpatialSignature();
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(emitGcode(useStore.getState().project, options).gcode).not.toBe(before);
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });
  it('retains offset intent when live controller power can make a profile S0 sample burn', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, maxPowerS: 1 },
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer, index) => ({
            ...layer,
            output: index === 0,
            power: 0.01,
          })),
        },
      },
    }));
    const project = useStore.getState().project;
    expect(emitGcode(project).gcode).not.toContain('G1 Z');
    expect(emitGcode(project, { laserMaxPowerS: 10000 }).gcode).toContain('G1 Z');
    const spatial = currentFrameSpatialSignature();
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
  });
  it('does not invent a starting Z datum for recovery, including replay from line one', () => {
    const project = useStore.getState().project;
    const gcode = emitGcode(project).gcode;
    const zLine = gcode.split('\n').findIndex((line) => line.includes('G1 Z')) + 1;
    expect(zLine).toBeGreaterThan(0);
    for (const line of [1, zLine, zLine + 2]) {
      expect(buildLaserResumeProgram(gcode, line, project.device)).toMatchObject({
        kind: 'error',
        reason: expect.stringContaining('original starting Z focus'),
      });
    }
    expect(
      buildLaserResumeProgram('G21\nG90\nM4 S0\nG1 X1 Y1 F300 S20\nM5', 1, project.device).kind,
    ).toBe('ok');
  });
  it('retains Frame for Z-feed-only edits but changes execution identity and emitted bytes', () => {
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    const bytes = fingerprintGcode(emitGcode(useStore.getState().project).gcode);
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -1, travelFeedMmPerMin: 450 } });
    expect(currentFrameSpatialSignature()).toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
    expect(fingerprintGcode(emitGcode(useStore.getState().project).gcode)).not.toEqual(bytes);
  });
  it('invalidates Frame and execution identity when the Z offset changes', () => {
    const spatial = currentFrameSpatialSignature();
    const execution = currentReplayExecutionSignature();
    useStore
      .getState()
      .setLayerParam('focus-test-1', { focusTest: { offsetMm: -2, travelFeedMmPerMin: 300 } });
    expect(currentFrameSpatialSignature()).not.toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(execution);
  });
  it('settings paste preserves each sample offset instead of copying Z intent', () => {
    useStore.getState().setLayerParam('focus-test-1', { speed: 777 });
    useStore.getState().copyLayerSettings('focus-test-1');
    useStore.getState().pasteLayerSettings('focus-test-3');
    const target = useStore
      .getState()
      .project.scene.layers.find((layer) => layer.id === 'focus-test-3');
    expect(target?.speed).toBe(777);
    expect(target?.focusTest).toEqual({ offsetMm: 1, travelFeedMmPerMin: 300 });
    useStore.getState().undo();
    expect(
      useStore.getState().project.scene.layers.find((layer) => layer.id === 'focus-test-3')?.speed,
    ).toBe(1200);
  });
});
