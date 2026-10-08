import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CNC_CONTEXT_PRESET } from '../../__fixtures__/cnc-cutting-preset';
import { cncCuttingValues } from '../../core/cnc/cutting-preset';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type CncLayerSettings } from '../../core/scene';
import type { CncCuttingContext, CncCuttingValues } from '../../core/scene/cnc-cutting-preset';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncSaveCuttingPresetRows } from './CncSaveCuttingPresetRows';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const LAYER = createLayer({ id: 'trial', color: '#000000' });
const CONTEXT = fixtureContext();
const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  ...cncCuttingValues(CNC_CONTEXT_PRESET),
  materialKey: CONTEXT.materialKey,
};
const NOTES = 'Operator notebook: material cut on this setup with these cutting values.';
const REFERENCE = 'Workshop trial notebook, page 9';
const VALUE_CHANGES: ReadonlyArray<readonly [keyof CncCuttingValues, number]> = [
  ['feedMmPerMin', 900],
  ['plungeMmPerMin', 210],
  ['spindleRpm', 15000],
  ['depthPerPassMm', 0.7],
  ['stepoverPercent', 40],
];
const CONTEXT_CHANGES: ReadonlyArray<readonly [string, CncCuttingContext | null]> = [
  ['material', { ...CONTEXT, materialKey: 'aluminium' }],
  ['cutter geometry', { ...CONTEXT, tool: { ...CONTEXT.tool, diameterMm: 6 } }],
  ['cutter identity', { ...CONTEXT, tool: { ...CONTEXT.tool, id: 'other-bit' } }],
  ['cutter family', { ...CONTEXT, tool: { ...CONTEXT.tool, family: 'upcut' } }],
  ['machine profile', { ...CONTEXT, machine: { ...CONTEXT.machine, profileId: 'router-b' } }],
  ['controller', { ...CONTEXT, machine: { ...CONTEXT.machine, controllerKind: 'grblhal' } }],
  ['spindle limit', { ...CONTEXT, machine: { ...CONTEXT.machine, spindleMaxRpm: 18000 } }],
  ['feed limit', { ...CONTEXT, machine: { ...CONTEXT.machine, maxFeedMmPerMin: 2500 } }],
  ['missing context', null],
];
let root: Root;
let host: HTMLDivElement;

function fixtureContext(): CncCuttingContext {
  if (CNC_CONTEXT_PRESET.context === undefined) throw new Error('Trial context missing');
  return CNC_CONTEXT_PRESET.context;
}
beforeEach(() => {
  resetStore();
  useStore.setState({ cncLibrary: { customTools: [], feedPresets: [], machineProfiles: [] } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetStore();
});
async function render(
  settings = SETTINGS,
  context: CncCuttingContext | null = CONTEXT,
): Promise<void> {
  await act(async () =>
    root.render(<CncSaveCuttingPresetRows layer={LAYER} settings={settings} context={context} />),
  );
}
async function fill(label: string, value: string): Promise<void> {
  const field = host.querySelector('[aria-label="' + label + '"]');
  if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement))
    throw new Error('Missing field: ' + label);
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  await act(async () => field.dispatchEvent(new Event('input', { bubbles: true })));
}
function qualification(): HTMLInputElement {
  const field = host.querySelector(
    'input[aria-label="Operator qualification for current cutting values"]',
  );
  if (!(field instanceof HTMLInputElement)) throw new Error('Qualification field missing');
  return field;
}
function saveButton(): HTMLButtonElement {
  const button = host.querySelector('button[aria-label="Save feeds preset for #000000"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Save button missing');
  return button;
}
function saved() {
  const preset = useStore.getState().cncLibrary.feedPresets.at(-1);
  if (preset === undefined) throw new Error('Cutting record was not saved');
  return preset;
}
async function enterEvidence(): Promise<void> {
  await fill('New feeds preset name for #000000', 'Trial feeds');
  await fill('Cutting preset source reference', REFERENCE);
  await fill('Cutting preset qualification notes', NOTES);
}
async function reviewTrial(): Promise<void> {
  await render();
  await enterEvidence();
  await act(async () => qualification().click());
  expect(qualification().checked).toBe(true);
}

describe('cutting qualification belongs to exact captured inputs', () => {
  it('saves generic values with notes and provenance while qualification stays unavailable', async () => {
    await render(SETTINGS, null);
    await enterEvidence();
    expect(qualification().disabled).toBe(true);
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(saved()).toMatchObject({
      ...cncCuttingValues(SETTINGS),
      units: 'mm-min-rpm',
      provenance: { kind: 'operator', reference: REFERENCE },
      qualification: { status: 'unverified', notes: NOTES },
    });
    expect(saved()).not.toHaveProperty('context');
  });
  it('requires supporting notes before saving qualification for complete exact inputs', async () => {
    await render();
    await fill('New feeds preset name for #000000', 'Trial feeds');
    await act(async () => qualification().click());
    expect(saveButton().disabled).toBe(true);
    expect(host.textContent).toContain('Record supporting trial notes');
    await fill('Cutting preset qualification notes', NOTES);
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(saved()).toMatchObject({
      ...cncCuttingValues(SETTINGS),
      context: CONTEXT,
      qualification: { status: 'operator-qualified', notes: NOTES },
    });
  });
  it.each(VALUE_CHANGES)(
    'revokes qualification when %s changes and retains the trial notes',
    async (key, value) => {
      await reviewTrial();
      expect(SETTINGS[key]).not.toBe(value);
      const changed = { ...SETTINGS, [key]: value };
      await render(changed);
      expect(qualification().checked).toBe(false);
      expect(saveButton().disabled).toBe(false);
      await act(async () => saveButton().click());
      expect(saved()).toMatchObject({
        ...cncCuttingValues(changed),
        context: CONTEXT,
        provenance: { kind: 'operator', reference: REFERENCE },
        qualification: { status: 'unverified', notes: NOTES },
      });
    },
  );
  it.each(CONTEXT_CHANGES)(
    'revokes qualification after a change to %s without discarding supporting notes',
    async (_label, context) => {
      await reviewTrial();
      await render(SETTINGS, context);
      expect(qualification().checked).toBe(false);
      expect(qualification().disabled).toBe(context === null);
      await act(async () => saveButton().click());
      expect(saved().qualification).toEqual({ status: 'unverified', notes: NOTES });
      expect(saved().provenance).toEqual({ kind: 'operator', reference: REFERENCE });
      if (context === null) expect(saved()).not.toHaveProperty('context');
      else expect(saved().context).toEqual(context);
    },
  );
  it('requires deliberate reconfirmation after changing and reverting cutting values', async () => {
    await reviewTrial();
    await render({ ...SETTINGS, feedMmPerMin: SETTINGS.feedMmPerMin + 100 });
    await render(SETTINGS);
    expect(qualification().checked).toBe(false);
    await act(async () => saveButton().click());
    expect(saved().qualification?.status).toBe('unverified');
    await fill('New feeds preset name for #000000', 'Reconfirmed feeds');
    await act(async () => qualification().click());
    await act(async () => saveButton().click());
    expect(saved()).toMatchObject({
      context: CONTEXT,
      qualification: { status: 'operator-qualified', notes: NOTES },
    });
  });
  it('does not resurrect qualification when missing context is restored', async () => {
    await reviewTrial();
    await render(SETTINGS, null);
    await render(SETTINGS, CONTEXT);
    expect(qualification().checked).toBe(false);
    await act(async () => saveButton().click());
    expect(saved()).toMatchObject({
      context: CONTEXT,
      qualification: { status: 'unverified', notes: NOTES },
    });
  });
});
