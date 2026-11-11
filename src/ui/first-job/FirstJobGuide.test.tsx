// ADR-698: the guided first job panel. Each step points at its real control,
// moves on when real state changes, and never presses a machine control.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useFirstJobGuideStore, openFirstJobGuide } from './first-job-guide-store';
import { FIRST_JOB_STEP_IDS, FIRST_JOB_STEPS, type FirstJobSignals } from './first-job-steps';
import { FirstJobGuideHost } from './FirstJobGuide';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOTHING: FirstJobSignals = {
  connected: false,
  machineConfigured: false,
  hasArtwork: false,
  materialChosen: false,
  framedReady: false,
  jobStarted: false,
};
let signals: FirstJobSignals = NOTHING;

vi.mock('./use-first-job-signals', () => ({ useFirstJobSignals: () => signals }));
const reveal = vi.hoisted(() => vi.fn());
vi.mock('../commands/search-entries', () => ({ revealSearchTarget: reveal }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  resetStore();
  signals = NOTHING;
  reveal.mockClear();
  useFirstJobGuideStore.setState({ open: false, skipped: new Set(), jobStarted: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<FirstJobGuideHost />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  useFirstJobGuideStore.setState({ open: false, skipped: new Set(), jobStarted: false });
  document.body.replaceChildren();
});

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('aside[aria-label="Guided first job"]');
  if (found === null) throw new Error('guide is not open');
  return found;
}

function currentStep(): HTMLElement | null {
  return panel().querySelector<HTMLElement>('[aria-current="step"]');
}

function buttonNamed(text: string): HTMLButtonElement {
  const found = [...panel().querySelectorAll('button')].find((b) => b.textContent === text);
  if (found === undefined) throw new Error(`${text} missing`);
  return found;
}

let renders = 0;

async function setSignals(next: Partial<FirstJobSignals>): Promise<void> {
  signals = { ...signals, ...next };
  // The real hook re-renders on its stores' changes; here a fresh render does.
  // The guide keeps its own state in its store, so nothing is lost.
  renders += 1;
  await act(async () => root.render(<FirstJobGuideHost key={renders} />));
}

describe('guided first job panel', () => {
  it('opens from Help, closes, and reopens where the operator left off', async () => {
    expect(document.querySelector('aside[aria-label="Guided first job"]')).toBeNull();
    await act(async () => openFirstJobGuide());
    await setSignals({ connected: true });
    expect(currentStep()?.textContent).toContain('Choose your machine');
    const close = panel().querySelector<HTMLButtonElement>(
      'button[aria-label="Close the guided first job"]',
    );
    await act(async () => close?.click());
    expect(document.querySelector('aside[aria-label="Guided first job"]')).toBeNull();
    await act(async () => openFirstJobGuide());
    expect(currentStep()?.textContent).toContain('Choose your machine');
  });

  it.each(FIRST_JOB_STEP_IDS.map((id, index) => ({ id, index })))(
    'step $index ($id) shows its instruction and highlights its control until its state changes',
    async ({ id, index }) => {
      const earlier: Partial<FirstJobSignals> = {
        connected: index > 0,
        machineConfigured: index > 1,
        hasArtwork: index > 2,
        materialChosen: index > 3,
        framedReady: index > 4,
      };
      await act(async () => openFirstJobGuide());
      await setSignals(earlier);
      const step = FIRST_JOB_STEPS[id];
      expect(currentStep()?.textContent).toContain(step.instruction);
      expect(panel().textContent).toContain(`Step ${index + 1} of 6: ${step.title}`);
      expect(document.body.dataset['firstJobTarget']).toBe(step.target);
      if (step.target !== undefined) {
        await act(async () => buttonNamed(`Show me ${step.targetLabel}`).click());
        expect(reveal).toHaveBeenCalledExactlyOnceWith(step.target, step.targetLabel);
      }
      const own: Record<string, keyof FirstJobSignals> = {
        connect: 'connected',
        machine: 'machineConfigured',
        artwork: 'hasArtwork',
        material: 'materialChosen',
        frame: 'framedReady',
        start: 'jobStarted',
      };
      await setSignals({ [own[id] as string]: true });
      const mark = panel().querySelector(`[aria-label="${step.title}: done"]`);
      expect(mark?.textContent).toContain(step.done);
      if (id === 'start') {
        expect(currentStep()).toBeNull();
        expect(panel().textContent).toContain('Your first job is under way');
        expect(document.body.dataset['firstJobTarget']).toBeUndefined();
      } else {
        expect(currentStep()?.textContent).toContain(
          FIRST_JOB_STEPS[FIRST_JOB_STEP_IDS[index + 1] ?? 'start'].title,
        );
      }
    },
  );

  it('adds a sample circle only when asked, as ordinary undoable artwork', async () => {
    await act(async () => openFirstJobGuide());
    await setSignals({ connected: true, machineConfigured: true });
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    await act(async () => buttonNamed('Add a sample circle').click());
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ kind: 'shape', spec: { kind: 'ellipse', widthMm: 40 } });
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
  });

  it('lets the operator skip the machine and material steps, never Frame or Start', async () => {
    await act(async () => openFirstJobGuide());
    await setSignals({ connected: true });
    await act(async () => buttonNamed('Skip this step').click());
    expect(currentStep()?.textContent).toContain('Put something on the canvas');
    expect([...panel().querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Skip this step',
    );
    await setSignals({ hasArtwork: true });
    await act(async () => buttonNamed('Skip this step').click());
    expect(currentStep()?.textContent).toContain('Frame it');
    expect([...panel().querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Skip this step',
    );
  });

  it('never touches the controller or a setting itself', async () => {
    const laser = useLaserStore.getState();
    const project = useStore.getState().project;
    await act(async () => openFirstJobGuide());
    for (const index of FIRST_JOB_STEP_IDS.keys()) {
      await setSignals({
        connected: index > 0,
        machineConfigured: index > 1,
        hasArtwork: index > 2,
        materialChosen: index > 3,
        framedReady: index > 4,
      });
      // Every button but Close, the operator-requested sample and Skip.
      const showMe = [...panel().querySelectorAll('button')].filter((button) =>
        button.textContent?.startsWith('Show me'),
      );
      for (const button of showMe) await act(async () => button.click());
    }
    expect(reveal).toHaveBeenCalledTimes(5);
    expect(useLaserStore.getState()).toBe(laser);
    expect(useStore.getState().project).toBe(project);
  });
});
