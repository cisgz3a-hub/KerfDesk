// The guided first job (ADR-698): six steps from a new install to a running
// laser job, each one done when the app's own state says so. Pure: no React or
// store. The guide never presses a machine control or changes a setting; each
// step points at the real control and waits for the operator to use it.

import type { SearchTarget } from '../commands/search-entries';

export const FIRST_JOB_STEP_IDS = [
  'connect',
  'machine',
  'artwork',
  'material',
  'frame',
  'start',
] as const;

export type FirstJobStepId = (typeof FIRST_JOB_STEP_IDS)[number];

/** What the app reports right now. Each field is read from real state. */
export type FirstJobSignals = {
  readonly connected: boolean;
  /** Machine Setup was saved for the connected profile and controller. */
  readonly machineConfigured: boolean;
  readonly hasArtwork: boolean;
  /** A job material is chosen, or an operation in use matches or links a preset. */
  readonly materialChosen: boolean;
  /** A clean Frame of this exact footprint and placement has completed. */
  readonly framedReady: boolean;
  /** A job was started while the guide was open. */
  readonly jobStarted: boolean;
};

export type FirstJobStep = {
  readonly id: FirstJobStepId;
  readonly title: string;
  readonly instruction: string;
  readonly done: string;
  /** The real control the step highlights and "Show me" reveals. */
  readonly target?: SearchTarget;
  readonly targetLabel?: string;
  /** The operator may say a step does not apply, such as a preset when they
   *  use settings from their laser's maker. Frame and Start are never skipped. */
  readonly skippable: boolean;
};

export const FIRST_JOB_STEPS: Readonly<Record<FirstJobStepId, FirstJobStep>> = {
  connect: {
    id: 'connect',
    title: 'Connect your laser',
    instruction:
      'Plug the laser in by USB and switch it on, then press Connect in the machine controls. Connecting only reads settings; nothing moves.',
    done: 'Connected.',
    target: 'connect',
    targetLabel: 'Connect',
    skippable: false,
  },
  machine: {
    id: 'machine',
    title: 'Choose your machine',
    instruction:
      'Open Machine Setup, pick your laser from the list, check its work area and press Save. KerfDesk then knows its size, origin and power range.',
    done: 'Machine Setup is saved for this laser.',
    target: 'machine-setup',
    targetLabel: 'Machine Setup',
    skippable: true,
  },
  artwork: {
    id: 'artwork',
    title: 'Put something on the canvas',
    instruction:
      'Import your own artwork with File → Import, draw a shape, or add a 40 mm sample circle with the button below.',
    done: 'Artwork is on the canvas.',
    skippable: false,
  },
  material: {
    id: 'material',
    title: 'Pick a material preset',
    instruction:
      'Open Materials in the Artwork panel, find your material and press Apply. No preset for it? Use the power and speed from your laser’s maker, or run Tools → Material Test on scrap, then skip this step.',
    done: 'The operation uses a material preset.',
    target: 'materials-tab',
    targetLabel: 'Materials',
    skippable: true,
  },
  frame: {
    id: 'frame',
    title: 'Frame it',
    instruction:
      'Put the material on the bed and focus the laser on it. If your laser has no homing, jog the head to the material’s corner and press Set origin here. Then press Frame job: the head traces the outline with the laser off. If the box is not on your material, move the artwork and Frame again.',
    done: 'Framed. Start is unlocked while the job and its place stay the same.',
    target: 'frame-job',
    targetLabel: 'Frame job',
    skippable: false,
  },
  start: {
    id: 'start',
    title: 'Start and stay with it',
    instruction:
      'Wear glasses made for your laser. Press Start, read Job Review and its warnings, then press Start job. Stay with the laser, and press ABORT JOB if anything looks wrong.',
    done: 'Your first job has started.',
    target: 'start-job',
    targetLabel: 'Start',
    skippable: false,
  },
};

export type FirstJobProgress = {
  readonly done: Readonly<Record<FirstJobStepId, boolean>>;
  /** The first step not yet done or skipped; null once the job has started. */
  readonly current: FirstJobStepId | null;
};

export function firstJobProgress(
  signals: FirstJobSignals,
  skipped: ReadonlySet<FirstJobStepId> = new Set(),
): FirstJobProgress {
  // A started job used its Frame: Start consumes the permit, so readiness
  // reads as expired once it runs, and that is not a step to redo.
  const done: Record<FirstJobStepId, boolean> = {
    connect: signals.connected || signals.jobStarted,
    machine: signals.machineConfigured,
    artwork: signals.hasArtwork,
    material: signals.materialChosen,
    frame: signals.framedReady || signals.jobStarted,
    start: signals.jobStarted,
  };
  const waiting = (id: FirstJobStepId): boolean =>
    !done[id] && !(FIRST_JOB_STEPS[id].skippable && skipped.has(id));
  const current = signals.jobStarted ? null : (FIRST_JOB_STEP_IDS.find(waiting) ?? null);
  return { done, current };
}
