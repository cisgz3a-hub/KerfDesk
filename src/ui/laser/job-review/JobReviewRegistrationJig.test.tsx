import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CutGroup } from '../../../core/job';
import {
  createProject,
  createRegistrationLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../../core/scene';
import { createRegistrationBox } from '../../../core/shapes/registration-box';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { useToastStore } from '../../state/toast-store';
import { JobReviewRegistrationJig } from './JobReviewRegistrationJig';
import {
  facts,
  registrationJigReviewOutput,
  type RegistrationJigReviewOutput,
} from './job-review-registration-jig';
import { useJobReviewStore } from './job-review-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function jigProject(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [createRegistrationBox({ widthMm: 80, heightMm: 40 })],
      layers: [createRegistrationLayer()],
    },
  };
}

function group(layerId: string): CutGroup {
  return {
    kind: 'cut',
    layerId,
    color: '#000000',
    power: 20,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    ],
  };
}

describe('registration jig reviewed output', () => {
  it('uses the exact compiled operations even when the scene toggle differs', () => {
    const project = jigProject();
    expect(project.scene.layers[0]?.output).toBe(true);
    expect(registrationJigReviewOutput(project, { groups: [group('art')] })).toBe('artwork');
    expect(registrationJigReviewOutput(project, { groups: [group('registration')] })).toBe('box');
    expect(
      registrationJigReviewOutput(project, { groups: [group('registration'), group('art')] }),
    ).toBe('mixed');
  });

  it('excludes captured boards, CNC, missing jigs, and empty jobs', () => {
    const project = jigProject();
    const job = { groups: [group('registration')] };
    expect(
      registrationJigReviewOutput(
        {
          ...project,
          scene: {
            ...project.scene,
            objects: [
              {
                ...createRegistrationBox({ widthMm: 80, heightMm: 40 }),
                provenance: 'captured-board',
              },
            ],
          },
        },
        job,
      ),
    ).toBeNull();
    expect(
      registrationJigReviewOutput({ ...project, machine: DEFAULT_CNC_MACHINE_CONFIG }, job),
    ).toBeNull();
    expect(registrationJigReviewOutput(createProject(), job)).toBeNull();
    expect(registrationJigReviewOutput(project, { groups: [] })).toBeNull();
  });
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().dismissToast(toast.id);
  resetStore();
});

async function render(
  output: RegistrationJigReviewOutput,
  isPreparing = false,
  wholeOutput = true,
): Promise<void> {
  await act(async () =>
    root.render(
      <JobReviewRegistrationJig
        output={output}
        wholeOutput={wholeOutput}
        isPreparing={isPreparing}
      />,
    ),
  );
}

describe('JobReviewRegistrationJig', () => {
  it('shows the sequence and a non-blocking focus reminder for artwork', async () => {
    await render('artwork');
    expect(host.textContent).toContain('This job burns the artwork only');
    expect(host.textContent).toContain('before placing the piece');
    expect(host.textContent).toContain('top surface of the piece');
    expect(host.textContent).toContain('does not change focus or move Z automatically');
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('cancels Start before changing the output and explains when another Frame is needed', async () => {
    const order: string[] = [];
    vi.spyOn(useJobReviewStore.getState(), 'cancel').mockImplementation(() => order.push('cancel'));
    vi.spyOn(useStore.getState(), 'setRegistrationOutput').mockImplementation((scope) =>
      order.push(scope),
    );
    await render('box');
    await act(async () => host.querySelector('button')?.click());
    expect(order).toEqual(['cancel', 'artwork']);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      'Frame if the footprint changed',
    );
  });

  it('calls out mixed output and offers each separate run without another gate', async () => {
    await render('mixed');
    expect(host.textContent).toContain('BOTH the outline and artwork');
    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Switch to Outline only',
      'Switch to Artwork only',
    ]);
  });

  it('promises the Artwork only switch only for a whole outline run', async () => {
    const promise = 'Artwork only is selected automatically';
    await render('box');
    expect(host.textContent).toContain(promise);
    await render('box', false, false);
    expect(host.textContent).not.toContain(promise);
    expect(host.textContent).toContain('This job burns the outline only');
  });

  it('derives whole output from the reviewed output scope', () => {
    const project = jigProject();
    const job = { groups: [group('registration')] };
    const scope = { cutSelectedGraphics: false, useSelectionOrigin: false };
    expect(facts(project, job, scope).registrationJigWholeOutput).toBe(true);
    expect(
      facts(project, job, { ...scope, cutSelectedGraphics: true }).registrationJigWholeOutput,
    ).toBe(false);
    expect(
      facts(project, job, { ...scope, useSelectionOrigin: true }).registrationJigWholeOutput,
    ).toBe(false);
  });

  it('prevents mode switching while preparation is in flight', async () => {
    await render('box', true);
    expect(host.querySelector('button')?.disabled).toBe(true);
  });
});
