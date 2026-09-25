// "New preset from this operation" entry points (ADR-381): the inspector
// button, the Cut Settings dialog button and the CNC feeds variant.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureMaterialRecipe, materialRecipePatch } from '../../core/material-library';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type Layer } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { LayerRowCutSettings } from './LayerRowCutSettings';
import { NewPresetFromOperation } from './NewPresetFromOperation';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => resetStore());
afterEach(() => resetStore());

const OPERATION: Layer = {
  ...createLayer({ id: 'op-engrave', color: '#224466', name: 'Engrave', mode: 'fill' }),
  power: 35,
  speed: 2200,
  passes: 2,
  hatchSpacingMm: 0.08,
  airAssist: true,
};

async function render(element: JSX.Element) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return found;
}

async function type(element: HTMLInputElement | null, value: string): Promise<void> {
  if (element === null) throw new Error('missing input');
  await act(async () => {
    element.value = value;
    Simulate.change(element);
  });
}

async function saveThroughWizard(host: HTMLElement): Promise<void> {
  const wizard = host.querySelector<HTMLElement>('[aria-label="New material preset"]');
  if (wizard === null) throw new Error('wizard not open');
  await type(wizard.querySelector('input[aria-label="Material name"]'), 'Maple');
  await type(wizard.querySelector('input[aria-label="Material thickness millimeters"]'), '3');
  for (let step = 0; step < 4; step++) {
    const form = wizard.querySelector('form');
    await act(async () => form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  }
}

describe('NewPresetFromOperation', () => {
  it('opens the preset wizard prefilled from a laser operation', async () => {
    const view = await render(<NewPresetFromOperation operation={OPERATION} machineKind="laser" />);
    try {
      await act(async () => button(view.host, 'New preset from this operation...').click());
      expect(view.host.textContent).toContain('Settings copied from Engrave.');
      await saveThroughWizard(view.host);
      expect(useStore.getState().materialLibrary?.entries[0]?.recipe).toEqual(
        materialRecipePatch(captureMaterialRecipe(OPERATION)),
      );
    } finally {
      await view.close();
    }
  });

  it('explains why a mixed selection cannot become one preset', async () => {
    const view = await render(
      <NewPresetFromOperation
        operation={OPERATION}
        machineKind="laser"
        unavailableReason="The selected artworks use different settings."
      />,
    );
    try {
      const trigger = button(view.host, 'New preset from this operation...');
      expect(trigger.disabled).toBe(true);
      expect(trigger.title).toBe('The selected artworks use different settings.');
    } finally {
      await view.close();
    }
  });

  it('saves a CNC operation as a feeds preset', async () => {
    const cncOperation: Layer = {
      ...OPERATION,
      name: 'Pocket',
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 900, spindleRpm: 16000 },
    };
    const view = await render(
      <NewPresetFromOperation operation={cncOperation} machineKind="cnc" />,
    );
    try {
      await act(async () => button(view.host, 'New preset from this operation...').click());
      expect(view.host.textContent).toContain('900 mm/min');
      await type(
        view.host.querySelector('input[aria-label="CNC feeds preset name"]'),
        'Pocket MDF',
      );
      await act(async () => button(view.host, 'Save preset').click());
      const saved = useStore.getState().cncLibrary.feedPresets.at(-1);
      expect(saved).toMatchObject({ name: 'Pocket MDF', feedMmPerMin: 900, spindleRpm: 16000 });
    } finally {
      await view.close();
    }
  });
});

describe('Cut Settings: New preset from these settings', () => {
  it('captures the values in the dialog without applying them', async () => {
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, layers: [OPERATION] } },
    }));
    const onClose = vi.fn();
    const view = await render(<LayerRowCutSettings layer={OPERATION} onClose={onClose} />);
    try {
      await type(view.host.querySelector('input[aria-label="Cut settings power"]'), '48');
      await act(async () => button(view.host, 'New preset from these settings...').click());
      await saveThroughWizard(view.host);
      expect(useStore.getState().materialLibrary?.entries[0]?.recipe).toMatchObject({
        power: 48,
        speed: 2200,
        passes: 2,
        hatchSpacingMm: 0.08,
      });
      // Saving a preset is not Apply: the operation keeps its own power.
      expect(useStore.getState().project.scene.layers[0]?.power).toBe(35);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      await view.close();
    }
  });
});
