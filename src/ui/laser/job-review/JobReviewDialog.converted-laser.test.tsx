// Job Review's question for a CNC that KerfDesk 1.0.29 may have made from a
// laser (rolling audit v10 V2-P2-2, ADR-637 Amendment 8), rendered.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { useStore } from '../../state';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  CONVERTED_LASER_START_TITLE,
  useConvertedLaserAnswerStore,
} from '../../state/converted-laser-question';
import { resetStore } from '../../state/test-helpers';
import { useMachineSetupDialogStore } from '../device-setup/machine-setup-dialog-store';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';
import { JobReviewDialog } from './JobReviewDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const asking: JobReviewModel = {
  machineKind: 'cnc',
  stats: [],
  warnings: [],
  resolvedOriginLabel: 'Current position — anchor front left',
  toolPlanLabels: [],
  outputQualityFacts: [],
  effectiveOperations: [],
  acknowledgement: { kind: 'cnc', prompt: 'CNC attestation prompt body.' },
  convertedLaser: {
    hints: [
      { kind: 'laser-mode', enabled: false },
      { kind: 'laser-power-scale', maxPowerS: 1000 },
    ],
  },
};

let host: HTMLDivElement;
let root: Root | null = null;

function reset(): void {
  resetStore();
  useJobReviewStore.getState().close();
  useMachineSetupDialogStore.getState().close();
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  try {
    window.localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
  } catch {
    // Node 25's own localStorage may stand in for jsdom's here.
  }
}

beforeEach(() => {
  reset();
  useStore.setState({ project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG } });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  reset();
});

async function render(): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(<JobReviewDialog />);
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (match === undefined) throw new Error(`Button "${text}" not found`);
  return match;
}

describe('Job Review on a CNC that 1.0.29 may have made from a laser', () => {
  it('asks first, names the beam and the controller hints, and holds Start and the store', async () => {
    useJobReviewStore.getState().open(asking);
    await render();

    const question = host.querySelector('[aria-label="Is this machine a laser?"]');
    expect(question?.textContent).toContain('turns the laser on at full power');
    expect(question?.textContent).toContain(
      'Your controller reports laser mode off ($32=0) and $30=1000 (the power scale lasers use).',
    );
    const start = buttonByText('Start job');
    expect(start.disabled).toBe(true);
    expect(start.title).toBe(CONVERTED_LASER_START_TITLE);
    // A keyboard, remote or stray caller cannot confirm past it either.
    await act(async () => useJobReviewStore.getState().confirm());
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  });

  it('keeps "This is a CNC router" and rebuilds the review', async () => {
    useJobReviewStore.getState().open(asking);
    await render();

    await act(async () => buttonByText('This is a CNC router').click());

    expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(true);
    expect(useJobReviewStore.getState().pendingSignal).toBe('rebuild');
  });

  it('closes the review for "It\'s a laser" and opens Machine Setup, changing nothing', async () => {
    useJobReviewStore.getState().open(asking);
    await render();

    await act(async () => buttonByText("It's a laser: open Machine Setup").click());

    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expect(useMachineSetupDialogStore.getState().state.kind).toBe('open');
    expect(useStore.getState().project.machine?.kind).toBe('cnc');
    expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(false);
  });

  it('shows no question and leaves Start alone when the model holds none', async () => {
    const { convertedLaser: _none, ...plain } = asking;
    useJobReviewStore.getState().open(plain);
    await render();
    expect(host.querySelector('[aria-label="Is this machine a laser?"]')).toBeNull();
    expect(buttonByText('Start job').disabled).toBe(false);
  });
});
