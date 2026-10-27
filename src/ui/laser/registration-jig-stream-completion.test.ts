import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { compileJob } from '../../core/job';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  registrationRunState,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { registrationOutlinePlacement } from '../state/registration-outline-run';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import {
  armRegistrationJigCompletion,
  cancelRegistrationJigCompletion,
} from './registration-jig-stream-completion';
import {
  armVariableStreamAdvancement,
  cancelVariableStreamAdvancement,
} from './variable-stream-advancement';

const RUN = 'jig-outline-run';

function args() {
  const project = useStore.getState().project;
  return {
    project,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    job: compileJob(project.scene, project.device),
    runId: RUN,
  };
}

function readyToSettle(idleReports = 0): Partial<LaserState> {
  return {
    activeRunId: RUN,
    streamerEpoch: useLaserStore.getState().streamerEpoch + 1,
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: null,
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    streamer: { ...step(createStreamer('G1 X1')).state, status: 'done' },
    controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports },
  };
}

function settle(): void {
  useLaserStore.setState(readyToSettle());
  useLaserStore.setState({ streamer: null, controllerOperation: null });
}

function outlineEnabled(): boolean {
  return useStore.getState().project.scene.layers.find((layer) => layer.id === 'registration')!
    .output;
}

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ registrationArtworkOutputSnapshot: null });
  useStore.getState().addRegistrationBox(80, 40);
  useStore.getState().drawShape(
    createRectangle({
      id: 'artwork',
      color: '#0000ff',
      transform: IDENTITY_TRANSFORM,
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
    }),
  );
  useStore.getState().setRegistrationOutput('box');
});

afterEach(() => {
  cancelRegistrationJigCompletion();
  cancelVariableStreamAdvancement();
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('registration jig completion', () => {
  it('waits for physical settlement, then switches once and reminds the operator about surface focus', () => {
    const observer = armRegistrationJigCompletion(args());
    expect(observer).not.toBeNull();
    observer!.accept();
    useLaserStore.setState(readyToSettle());
    expect(outlineEnabled()).toBe(true);
    useLaserStore.setState({ streamer: null, controllerOperation: null });
    expect(outlineEnabled()).toBe(false);
    expect(registrationRunState(useStore.getState().project.scene)).toBe('artwork');
    const project = useStore.getState().project;
    observer!.accept();
    settle();
    expect(useStore.getState().project).toBe(project);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.message).toContain('set focus for its top surface');
  });

  it('handles a tiny run settling before transport acceptance', () => {
    const observer = armRegistrationJigCompletion(args());
    settle();
    expect(outlineEnabled()).toBe(true);
    observer!.accept();
    expect(outlineEnabled()).toBe(false);
  });

  it('does not switch when handoff is rejected after local settlement', () => {
    const observer = armRegistrationJigCompletion(args());
    settle();
    observer!.cancel();
    observer!.accept();
    expect(outlineEnabled()).toBe(true);
  });

  it.each(['cancelled', 'errored', 'disconnected'] as const)(
    'does not switch after %s',
    (status) => {
      armRegistrationJigCompletion(args())!.accept();
      const ready = readyToSettle();
      useLaserStore.setState({ ...ready, streamer: { ...ready.streamer!, status } });
      useLaserStore.setState({ streamer: null, controllerOperation: null });
      expect(outlineEnabled()).toBe(true);
    },
  );

  it.each(['missing-settle', 'disconnected'] as const)(
    'does not switch after a fallback release with %s',
    (reason) => {
      armRegistrationJigCompletion(args())!.accept();
      useLaserStore.setState(readyToSettle());
      if (reason === 'missing-settle') useLaserStore.setState({ controllerOperation: null });
      useLaserStore.setState({
        streamer: null,
        controllerOperation: null,
        ...(reason === 'disconnected' ? { connection: { kind: 'disconnected' as const } } : {}),
      });
      expect(outlineEnabled()).toBe(true);
    },
  );

  it.each(['document', 'scene', 'placement'] as const)(
    'does not overwrite a changed %s',
    (change) => {
      armRegistrationJigCompletion(args())!.accept();
      const state = useStore.getState();
      if (change === 'document')
        useStore.setState({ projectDocumentEpoch: state.projectDocumentEpoch + 1 });
      if (change === 'scene')
        useStore.setState({ project: { ...state.project, scene: { ...state.project.scene } } });
      if (change === 'placement') useStore.setState({ jobPlacement: { ...state.jobPlacement } });
      settle();
      expect(outlineEnabled()).toBe(true);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    },
  );

  it('does not observe another run or a superseded observer', () => {
    const old = armRegistrationJigCompletion(args())!;
    const current = armRegistrationJigCompletion(args())!;
    old.accept();
    useLaserStore.setState({ ...readyToSettle(), activeRunId: 'different-run' });
    current.accept();
    settle();
    expect(outlineEnabled()).toBe(true);
  });

  it('coexists with variable tracking without consuming artwork records for outline output', () => {
    const project = {
      ...useStore.getState().project,
      variables: {
        recordIndex: 0,
        serialValue: 7,
        advancement: 'after-successful-stream' as const,
      },
    };
    useStore.setState({ project });
    const variables = armVariableStreamAdvancement(project, RUN)!;
    const jig = armRegistrationJigCompletion(args())!;
    variables.accept();
    jig.accept();
    settle();
    expect(useStore.getState().project.variables?.serialValue).toBe(7);
    expect(outlineEnabled()).toBe(false);
  });

  it('preserves a variable-only update made during completion', () => {
    const project = useStore.getState().project;
    const observer = armRegistrationJigCompletion(args())!;
    settle();
    useStore.setState({
      project: { ...project, variables: { ...project.variables!, serialValue: 8 } },
    });
    observer.accept();
    expect(useStore.getState().project.variables?.serialValue).toBe(8);
    expect(outlineEnabled()).toBe(false);
  });

  it('refuses partial output, empty/mixed jobs, changed sources and captured boards', () => {
    const source = args();
    expect(
      armRegistrationJigCompletion({
        ...source,
        outputScope: { ...DEFAULT_OUTPUT_SCOPE, cutSelectedGraphics: true },
      }),
    ).toBeNull();
    expect(armRegistrationJigCompletion({ ...source, job: { groups: [] } })).toBeNull();
    expect(
      armRegistrationJigCompletion({
        ...source,
        job: { groups: source.job.groups.map((group) => ({ ...group, layerId: 'artwork' })) },
      }),
    ).toBeNull();
    expect(
      armRegistrationJigCompletion({
        ...source,
        project: { ...source.project, scene: { ...source.project.scene } },
      }),
    ).toBeNull();
    const captured = {
      ...source.project,
      scene: {
        ...source.project.scene,
        objects: source.project.scene.objects.map((object) => ({
          ...object,
          provenance: 'captured-board' as const,
        })),
      },
    };
    useStore.setState({ project: captured });
    expect(armRegistrationJigCompletion(args())).toBeNull();
  });

  it('leaves an operator-selected output mode untouched', () => {
    armRegistrationJigCompletion(args())!.accept();
    useStore.getState().setRegistrationOutput('artwork');
    const project = useStore.getState().project;
    settle();
    expect(useStore.getState().project).toBe(project);
    expect(registrationRunState(project.scene)).not.toBe('box');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('ignores pre-start updates for a previous completed run', () => {
    useLaserStore.setState({ activeRunId: 'prior-completed', streamer: null });
    const observer = armRegistrationJigCompletion(args())!;
    useLaserStore.setState({ lastWriteError: null });
    observer.accept();
    settle();
    expect(outlineEnabled()).toBe(false);
  });

  it.each(['session', 'stream'] as const)(
    'rejects replacement of the %s before acceptance',
    (owner) => {
      const observer = armRegistrationJigCompletion(args())!;
      settle();
      const state = useLaserStore.getState();
      useLaserStore.setState(
        owner === 'session'
          ? { controllerSessionEpoch: state.controllerSessionEpoch + 1 }
          : { streamerEpoch: state.streamerEpoch + 1 },
      );
      observer.accept();
      expect(outlineEnabled()).toBe(true);
    },
  );

  it('keeps Outline only and says so when no artwork is set to burn', () => {
    useStore.getState().setRegistrationOutput('artwork');
    for (const layer of useStore.getState().project.scene.layers)
      if (layer.id !== 'registration')
        useStore.getState().setLayerParam(layer.id, { output: false });
    useStore.getState().setRegistrationOutput('box');
    const observer = armRegistrationJigCompletion(args())!;
    observer.accept();
    settle();
    expect(outlineEnabled()).toBe(true);
    expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.message).toContain('Outline only stays selected');
  });

  it('keeps Outline only and says so when run numbering refuses the switch', () => {
    const observer = armRegistrationJigCompletion(args())!;
    observer.accept();
    // Numbering opened from the Run order panel while the outline burned.
    useStore.getState().beginInteraction();
    useUiStore.getState().startArtworkNumbering([]);
    try {
      settle();
      expect(outlineEnabled()).toBe(true);
      expect(registrationRunState(useStore.getState().project.scene)).toBe('box');
      const messages = useToastStore.getState().toasts.map((toast) => toast.message);
      expect(messages.some((message) => message.includes('Artwork only is now selected'))).toBe(
        false,
      );
      expect(messages.some((message) => message.includes('Outline only stays selected'))).toBe(
        true,
      );
    } finally {
      useUiStore.getState().finishArtworkNumbering();
      useStore.getState().cancelInteraction();
    }
  });

  it('does not arm for CNC output', () => {
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    expect(armRegistrationJigCompletion(args())).toBeNull();
  });

  // ADR-057 Amendment 6 (rolling audit v5 J5-P2-1).
  it('records the Start from a finished outline burned with, and never a failed one', () => {
    const userOrigin = { startFrom: 'user-origin', anchor: 'center' } as const;
    const failed = armRegistrationJigCompletion({ ...args(), jobOrigin: userOrigin });
    failed!.accept();
    const ready = readyToSettle();
    useLaserStore.setState({ ...ready, streamer: { ...ready.streamer!, status: 'errored' } });
    useLaserStore.setState({ streamer: null, controllerOperation: null });
    expect(useLaserStore.getState().registrationOutlineRun).toBeNull();

    armRegistrationJigCompletion({ ...args(), jobOrigin: userOrigin })!.accept();
    settle();
    const project = useStore.getState().project;
    const run = useLaserStore.getState().registrationOutlineRun;
    expect(run?.placement).toEqual({ startFrom: 'user-origin', anchor: 'center' });
    expect(registrationOutlinePlacement(project, run)).toEqual(userOrigin);
  });

  it('records Absolute Coordinates for an outline compiled without a job origin', () => {
    armRegistrationJigCompletion(args())!.accept();
    settle();
    expect(useLaserStore.getState().registrationOutlineRun?.placement.startFrom).toBe('absolute');
  });

  it('keeps a record for the same outline moved on the canvas, not for another one', () => {
    armRegistrationJigCompletion(args())!.accept();
    settle();
    const run = useLaserStore.getState().registrationOutlineRun;
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0]!;
    useStore.setState(({ project }) => ({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: project.scene.objects.map((object) =>
            object.id === box.id
              ? { ...object, transform: { ...object.transform, x: object.transform.x + 30 } }
              : object,
          ),
        },
      },
    }));
    expect(registrationOutlinePlacement(useStore.getState().project, run)).toEqual(run!.placement);
    useStore.getState().removeRegistrationBox();
    useStore.getState().addRegistrationBox(100, 60);
    expect(registrationOutlinePlacement(useStore.getState().project, run)).toBeNull();
  });
});
