// Rolling audit v10 V2-P2-2 (ADR-637 Amendment 8): the laser that KerfDesk
// 1.0.29's first Connect made a CNC is asked about when Machine Setup opens.
// "It's a laser" puts the draft on Laser and Save applies it; "This is a CNC
// router" is kept; Save alone is not an answer.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../../core/scene';
import { useStore } from '../../state';
import {
  CONVERTED_LASER_ANSWER_STORAGE_KEY,
  CONVERTED_LASER_HEADING,
  useConvertedLaserAnswerStore,
} from '../../state/converted-laser-question';
import { loadLastMachineSelection } from '../../state/last-machine-persistence';
import { useLaserStore } from '../../state/laser-store';
import { resolveProjectMachineCapability } from '../../state/project-machine-capability';
import { resetStore } from '../../state/test-helpers';
import { renderWizard } from './device-setup-wizard.test-support';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_BY_1_0_29 = readFileSync(
  resolve('src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json'),
  'utf8',
);

function startOnThe1029Machine(): void {
  const selection = loadLastMachineSelection({
    getItem: () => SAVED_BY_1_0_29,
    setItem: () => undefined,
  });
  if (selection === null) throw new Error('The 1.0.29 last machine did not load');
  useStore.setState({
    project: resolveProjectMachineCapability(
      createProject(selection.profile),
      [],
      selection.machineKind,
    ).project,
  });
}

function reset(): void {
  resetStore();
  useConvertedLaserAnswerStore.setState({ routerAnswered: false });
  localStorage.removeItem(CONVERTED_LASER_ANSWER_STORAGE_KEY);
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    detectedSettings: null,
    controllerSettings: null,
    detectedControllerKind: null,
    lastSettingsReadAt: null,
  });
}

beforeEach(reset);
afterEach(reset);

function question(host: HTMLElement): Element | undefined {
  return [...host.querySelectorAll('.lf-setup-laser-mode-off')].find((card) =>
    card.textContent?.includes(CONVERTED_LASER_HEADING),
  );
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not rendered: ${label}`);
  return match;
}

async function saveFromReview(host: HTMLElement, label: string): Promise<void> {
  await act(async () => button(host, 'Next').click());
  await act(async () => button(host, 'Next').click());
  await act(async () => button(host, label).click());
}

describe('Machine Setup on the CNC 1.0.29 made from a laser', () => {
  it('asks on open; "It\'s a laser" and Save make it a laser, and nothing is kept as an answer', async () => {
    startOnThe1029Machine();
    const view = await renderWizard(undefined, undefined, { configuredAs: 'cnc' });
    try {
      expect(question(view.host)?.textContent).toContain('turns the laser on at full power');

      await act(async () => button(view.host, "It's a laser").click());
      expect(question(view.host)).toBeUndefined();
      // Only Save changes the project.
      expect(useStore.getState().project.machine?.kind).toBe('cnc');

      await saveFromReview(view.host, 'Save machine setup');
      expect(useStore.getState().project.machine?.kind ?? 'laser').toBe('laser');
      expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('keeps "This is a CNC router"', async () => {
    startOnThe1029Machine();
    const view = await renderWizard(undefined, undefined, { configuredAs: 'cnc' });
    try {
      await act(async () => button(view.host, 'This is a CNC router').click());
      expect(question(view.host)).toBeUndefined();
      expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(true);
      expect(localStorage.getItem(CONVERTED_LASER_ANSWER_STORAGE_KEY)).toBe('cnc-router');
    } finally {
      await view.unmount();
    }
  });

  it('does not take Save alone as the answer', async () => {
    startOnThe1029Machine();
    const view = await renderWizard(undefined, undefined, { configuredAs: 'cnc' });
    try {
      await saveFromReview(view.host, 'Save CNC machine setup');
      expect(useStore.getState().project.machine?.kind).toBe('cnc');
      expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(false);
    } finally {
      await view.unmount();
    }
  });

  it('keeps a router the operator set up from the laser starter on this build as the answer', async () => {
    useStore.getState().setMachineKind('cnc');
    const view = await renderWizard();
    try {
      expect(question(view.host)).toBeUndefined();
      await saveFromReview(view.host, 'Save CNC machine setup');
      expect(useStore.getState().project.machine?.kind).toBe('cnc');
      expect(useConvertedLaserAnswerStore.getState().routerAnswered).toBe(true);
    } finally {
      await view.unmount();
    }
  });
});
