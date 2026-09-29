import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS } from '../../core/scene';
import { defaultCncTextCutType } from '../common/text-layer-policy';
import { PocketFillRow } from '../layers/PocketFillRow';
import { PresetPicker } from '../trace/dialog-parts';
import {
  EditionContext,
  setActiveEdition,
  UNRESTRICTED_EDITION,
  type EditionValue,
} from './edition';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';

// Pro choices inside Free tools (ADR-540): KerfDesk Free lists them marked
// "(Pro)", and choosing one asks for Pro before anything changes.

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  if (mounted !== undefined) await act(async () => mounted.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
  setActiveEdition(null);
});

function freeEdition(unlock = false): EditionValue & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    ...UNRESTRICTED_EDITION,
    licensed: true,
    pro: false,
    asked,
    requestPro: (feature, onAllowed) => {
      asked.push(feature);
      if (unlock) onAllowed?.();
      return false;
    },
  };
}

async function render(edition: EditionValue, node: JSX.Element): Promise<HTMLDivElement> {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const created = createRoot(element);
  host = element;
  root = created;
  await act(async () =>
    created.render(<EditionContext.Provider value={edition}>{node}</EditionContext.Provider>),
  );
  return element;
}

function select(within: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const field = within.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select missing: ${ariaLabel}`);
  return field;
}

async function change(field: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

function optionLabels(field: HTMLSelectElement): string[] {
  return Array.from(field.options, (option) => option.textContent ?? '');
}

const POCKET = { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const };
const LAYER = createLayer({ id: 'pocket', color: '#000000' });

describe('adaptive clearing choice', () => {
  it('is marked Pro and asks before it changes the layer in KerfDesk Free', async () => {
    const edition = freeEdition();
    const onCommit = vi.fn();
    const view = await render(
      edition,
      <PocketFillRow layer={LAYER} settings={POCKET} onCommit={onCommit} />,
    );
    const field = select(view, 'Pocket fill method');
    expect(optionLabels(field)).toContain('Adaptive clearing (Pro)');
    await change(field, 'adaptive');
    expect(edition.asked).toEqual(['adaptive-clearing']);
    expect(onCommit).not.toHaveBeenCalled();
    await change(field, 'raster-x');
    expect(onCommit).toHaveBeenCalledWith({ pocketStrategy: 'raster-x' });
  });

  it('applies once Pro is unlocked, and is a plain choice with Pro', async () => {
    const onCommit = vi.fn();
    const view = await render(
      freeEdition(true),
      <PocketFillRow layer={LAYER} settings={POCKET} onCommit={onCommit} />,
    );
    await change(select(view, 'Pocket fill method'), 'adaptive');
    expect(onCommit).toHaveBeenCalledWith({ pocketStrategy: 'adaptive' });
  });

  it('keeps an adaptive layer editable in KerfDesk Free', async () => {
    const edition = freeEdition();
    const onCommit = vi.fn();
    const view = await render(
      edition,
      <PocketFillRow
        layer={LAYER}
        settings={{ ...POCKET, pocketStrategy: 'adaptive' }}
        onCommit={onCommit}
      />,
    );
    await change(select(view, 'Pocket fill method'), 'offset');
    expect(onCommit).toHaveBeenCalledWith({ pocketStrategy: 'offset' });
    expect(edition.asked).toEqual([]);
  });
});

describe('advanced trace presets', () => {
  it('are marked Pro and ask before switching in KerfDesk Free', async () => {
    const edition = freeEdition();
    const onChange = vi.fn();
    const view = await render(
      edition,
      <PresetPicker machineKind="laser" value="Line Art" onChange={onChange} />,
    );
    const field = select(view, 'Trace preset');
    const labels = optionLabels(field);
    expect(labels).toEqual(
      expect.arrayContaining(['Photo shading (Pro)', 'Centerline (Pro)', 'Colour layers (Pro)']),
    );
    expect(labels).toEqual(expect.arrayContaining(['Line Art', 'Line + fill', 'Edge Detection']));
    await change(field, 'Centerline');
    expect(edition.asked).toEqual(['advanced-trace']);
    expect(onChange).not.toHaveBeenCalled();
    await change(field, 'Smooth');
    expect(onChange).toHaveBeenCalledWith('Smooth');
  });

  it('are plain choices with Pro', async () => {
    const onChange = vi.fn();
    const view = await render(
      UNRESTRICTED_EDITION,
      <PresetPicker machineKind="laser" value="Line Art" onChange={onChange} />,
    );
    const field = select(view, 'Trace preset');
    expect(optionLabels(field).some((label) => label.includes('(Pro)'))).toBe(false);
    await change(field, 'Photo shading');
    expect(onChange).toHaveBeenCalledWith('Photo shading');
  });
});

describe('new V-bit text', () => {
  const vbit = {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [{ id: 'v90', name: 'V-bit', kind: 'v-bit' as const, diameterMm: 6, tipAngleDeg: 90 }],
    toolId: 'v90',
  };

  it('starts as an engrave in KerfDesk Free, since V-carve is a Pro tool', () => {
    setActiveEdition(freeEdition());
    expect(defaultCncTextCutType(vbit, 'roboto-regular')).toBe('engrave');
    setActiveEdition(null);
    expect(defaultCncTextCutType(vbit, 'roboto-regular')).toBe('v-carve');
  });
});
