// ADR-698: the guided first job moves on only when real state changes.
import { describe, expect, it } from 'vitest';
import { captureMaterialRecipe } from '../../core/material-library';
import { createLayer, createProject } from '../../core/scene';
import { svgObj } from '../state/test-helpers';
import {
  FIRST_JOB_STEP_IDS,
  FIRST_JOB_STEPS,
  firstJobProgress,
  type FirstJobSignals,
  type FirstJobStepId,
} from './first-job-steps';
import { materialChosen } from './use-first-job-signals';

const NOTHING: FirstJobSignals = {
  connected: false,
  machineConfigured: false,
  hasArtwork: false,
  materialChosen: false,
  framedReady: false,
  jobStarted: false,
};

// Each step's own signal, in guide order.
const SIGNAL_OF: Record<FirstJobStepId, keyof FirstJobSignals> = {
  connect: 'connected',
  machine: 'machineConfigured',
  artwork: 'hasArtwork',
  material: 'materialChosen',
  frame: 'framedReady',
  start: 'jobStarted',
};

describe('guided first job steps', () => {
  it('runs connect, machine, artwork, material, Frame, Start in that order', () => {
    expect(FIRST_JOB_STEP_IDS).toEqual([
      'connect',
      'machine',
      'artwork',
      'material',
      'frame',
      'start',
    ]);
  });

  it.each(FIRST_JOB_STEP_IDS.map((id, index) => ({ id, index })))(
    '$id is current until its own state turns true, then the next step is',
    ({ id, index }) => {
      const before = Object.fromEntries(
        FIRST_JOB_STEP_IDS.slice(0, index).map((earlier) => [SIGNAL_OF[earlier], true]),
      );
      const waiting = firstJobProgress({ ...NOTHING, ...before });
      expect(waiting.current).toBe(id);
      expect(waiting.done[id]).toBe(false);
      const after = firstJobProgress({ ...NOTHING, ...before, [SIGNAL_OF[id]]: true });
      expect(after.done[id]).toBe(true);
      expect(after.current).toBe(FIRST_JOB_STEP_IDS[index + 1] ?? null);
    },
  );

  it('goes back to a step whose state is lost, such as a Frame the edit expired', () => {
    const framed = { ...NOTHING, connected: true, machineConfigured: true, hasArtwork: true };
    expect(firstJobProgress({ ...framed, materialChosen: true, framedReady: true }).current).toBe(
      'start',
    );
    expect(firstJobProgress({ ...framed, materialChosen: true, framedReady: false }).current).toBe(
      'frame',
    );
    expect(firstJobProgress({ ...framed, connected: false, materialChosen: true }).current).toBe(
      'connect',
    );
  });

  it('skips only the steps that allow it; Frame and Start always wait for the real state', () => {
    expect(FIRST_JOB_STEP_IDS.filter((id) => FIRST_JOB_STEPS[id].skippable)).toEqual([
      'machine',
      'material',
    ]);
    const skipped = new Set<FirstJobStepId>(['machine', 'material', 'frame', 'start']);
    const ready = { ...NOTHING, connected: true, hasArtwork: true };
    expect(firstJobProgress(ready, skipped).current).toBe('frame');
    expect(firstJobProgress({ ...ready, framedReady: true }, skipped).current).toBe('start');
  });

  it('finishes when a job starts, even though Start used up the Frame', () => {
    const progress = firstJobProgress({ ...NOTHING, jobStarted: true });
    expect(progress.current).toBeNull();
    expect(progress.done.frame).toBe(true);
    expect(progress.done.start).toBe(true);
  });

  it('points each step at a real control, except artwork, which offers a sample', () => {
    expect(FIRST_JOB_STEP_IDS.map((id) => FIRST_JOB_STEPS[id].target ?? null)).toEqual([
      'connect',
      'machine-setup',
      null,
      'materials-tab',
      'frame-job',
      'start-job',
    ]);
  });
});

describe('material step', () => {
  const layer = createLayer({ id: 'op', color: '#ff0000' });
  const art = { ...svgObj('art', ['#ff0000']), operationIds: [layer.id] };
  const project = { ...createProject(), scene: { layers: [layer], objects: [art] } };
  const preset = (power: number) => ({
    id: 'p',
    recipe: { ...captureMaterialRecipe(layer), power },
  });

  it('is done when an operation in use already holds a library preset', () => {
    const library = { entries: [preset(layer.power)] } as never;
    expect(materialChosen(project, library)).toBe(true);
    expect(materialChosen(project, { entries: [preset(layer.power + 7)] } as never)).toBe(false);
    expect(materialChosen(project, null)).toBe(false);
  });

  it('is done when a job material is chosen', () => {
    const chosen = {
      ...project,
      jobSetup: { ...project.jobSetup, laserMaterial: { name: 'Plywood', autoApplyRecipes: true } },
    };
    expect(materialChosen(chosen, null)).toBe(true);
  });

  it('ignores operations no artwork uses or that are left out of the output', () => {
    const library = { entries: [preset(layer.power)] } as never;
    const unused = { ...project, scene: { ...project.scene, objects: [] } };
    expect(materialChosen(unused, library)).toBe(false);
    const excluded = {
      ...project,
      scene: { ...project.scene, layers: [{ ...layer, output: false }] },
    };
    expect(materialChosen(excluded, library)).toBe(false);
  });
});
