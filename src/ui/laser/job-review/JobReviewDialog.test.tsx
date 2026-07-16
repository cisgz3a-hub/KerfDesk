import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
} from '../../../core/scene';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';
import { JobReviewDialog } from './JobReviewDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const model: JobReviewModel = {
  machineKind: 'laser',
  stats: [
    { label: 'Estimated time', value: '2m 5s', detail: 'Cut 1m 50s · travel 15s' },
    { label: 'Job size', value: '8 × 8 mm', detail: 'X 1 to 9 · Y 1 to 9 mm' },
    { label: 'Operations', value: '1 operation', detail: '1 pass total' },
    { label: 'G-code', value: '12 lines', detail: '1.2 KB' },
  ],
  warnings: ['Island fill can overburn small details.'],
  resolvedOriginLabel: 'User origin — anchor front left',
  toolPlanLabels: [],
  acknowledgement: { kind: 'laser-unverified', prompt: 'Controller laser mode prompt body.' },
};

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        ...EMPTY_SCENE,
        objects: [],
        layers: [createLayer({ id: 'red', color: '#ff0000' })],
      },
    },
  });
  useJobReviewStore.getState().close();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  useJobReviewStore.getState().close();
  resetStore();
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

describe('JobReviewDialog', () => {
  it('renders nothing while no review is pending', async () => {
    await render();
    expect(host.textContent).toBe('');
  });

  it('shows the full review and never wraps it in a form (Enter cannot start)', async () => {
    useJobReviewStore.getState().open(model);
    await render();

    expect(host.textContent).toContain('Review job before starting');
    expect(host.textContent).toContain('2m 5s');
    expect(host.textContent).toContain('8 × 8 mm');
    expect(host.textContent).toContain('Island fill can overburn small details.');
    expect(host.textContent).toContain('User origin — anchor front left');
    expect(host.textContent).toContain('Controller laser mode prompt body.');
    expect(host.textContent).toContain('Operations');
    expect(buttonByText('Start job').disabled).toBe(false);
    expect(host.querySelector('form')).toBeNull();
  });

  it('routes Cancel, Start, and Escape to the review store signals', async () => {
    useJobReviewStore.getState().open(model);
    await render();

    await act(async () => buttonByText('Start job').click());
    expect(useJobReviewStore.getState().pendingSignal).toBe('confirm');

    await act(async () => buttonByText('Cancel').click());
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');

    await act(async () => {
      useJobReviewStore.getState().close();
      useJobReviewStore.getState().open(model);
    });
    await act(async () => {
      host
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
  });

  it('disables Start while a re-prepare is in flight', async () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().beginPrepare();
    await render();

    const start = buttonByText('Start job');
    expect(start.disabled).toBe(true);
    expect(start.title).toMatch(/recomputing/i);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).toContain('Recomputing with your latest edits');
  });

  it('opens with focus on the dialog surface, not on an editable field', async () => {
    useJobReviewStore.getState().open(model);
    await render();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    const backdrop = host.querySelector('.lf-dialog-backdrop');
    expect(document.activeElement).toBe(backdrop);
  });

  it('renders the CNC variant: attestation, machine facts, and the tool plan', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useJobReviewStore.getState().open({
      ...model,
      machineKind: 'cnc',
      toolPlanLabels: ['1. 3.175 mm (1/8") end mill', '2. 60° V-bit'],
      acknowledgement: { kind: 'cnc', prompt: 'CNC attestation prompt body.' },
    });
    await render();

    expect(host.textContent).toContain('ROUTER');
    expect(host.textContent).toContain('CNC setup confirmation');
    expect(host.textContent).toContain('CNC attestation prompt body.');
    expect(host.textContent).toContain('Stock');
    expect(host.textContent).toContain('Safe Z');
    expect(host.textContent).toContain('1. 3.175 mm (1/8") end mill');
    expect(host.textContent).toContain('2. 60° V-bit');
  });

  it('surfaces a rebuild refusal as a blocker and keeps Confirm inert', async () => {
    useJobReviewStore.getState().open(model);
    useJobReviewStore.getState().failPrepare(['Controller reports Alarm.']);
    await render();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Controller reports Alarm.');
    const start = buttonByText('Start job');
    expect(start.disabled).toBe(true);
    await act(async () => start.click());
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  });
});
