import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN_LAYER, type DesignLayer } from '../../../core/design/layers';
import type { CncTool } from '../../../core/scene';
import { useMachineSetupDialogStore } from '../../laser/device-setup/machine-setup-dialog-store';
import { DesignLayerSettings } from './DesignLayerSettings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tools: ReadonlyArray<CncTool> = [
  { id: 'flat', name: 'Flat end mill', kind: 'end-mill', diameterMm: 3.175 },
  { id: 'ball', name: 'Ball nose', kind: 'ball-nose', diameterMm: 3.175 },
  {
    id: 'core-box',
    name: 'Core-box bit',
    kind: 'ball-nose',
    family: 'core-box',
    diameterMm: 6.35,
  },
  { id: 'engraver', name: 'Engraver', kind: 'engraving', diameterMm: 0.5 },
  { id: 'v90', name: '90 degree V-bit', kind: 'v-bit', diameterMm: 12.7, tipAngleDeg: 90 },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useMachineSetupDialogStore.setState({ state: { kind: 'idle' }, configuredRevision: 0 });
});

describe('DesignLayerSettings', () => {
  it('shows the Startup default bit read-only and deep-links to Tool Plan after explaining Apply', () => {
    const onPatch = vi.fn();
    renderSettings(DEFAULT_DESIGN_LAYER, onPatch);

    expect(host?.querySelectorAll('select')).toHaveLength(1);
    const bitReference = referenceButton('Bit');
    expect(bitReference.disabled).toBe(false);
    expect(bitReference.textContent).toContain('90 degree V-bit');
    expect(bitReference.textContent).toContain('Startup default');
    expect(host?.textContent).toContain(
      'Apply the design, then edit its operation in Startup Setup › Tool Plan.',
    );

    act(() => bitReference.click());
    expect(host?.querySelector('[role="note"]')?.textContent).toMatch(
      /inherits the current job default bit.*Apply the design first/i,
    );
    const edit = [...(host?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Edit in Startup Setup',
    );
    if (!(edit instanceof HTMLButtonElement)) throw new Error('Startup Setup action missing');
    act(() => edit.click());

    expect(useMachineSetupDialogStore.getState().state).toEqual({
      kind: 'open',
      target: { kind: 'cnc', field: 'tool-plan' },
      requestId: 1,
    });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('preserves known legacy primary and clearing ids as read-only saved overrides', () => {
    const onPatch = vi.fn();
    renderSettings(
      {
        ...DEFAULT_DESIGN_LAYER,
        cutType: 'v-carve',
        vCarveFlatDepthEnabled: true,
        toolId: 'v90',
        vClearToolId: 'ball',
      },
      onPatch,
    );

    expect(host?.querySelectorAll('select')).toHaveLength(1);
    expect(referenceButton('Bit').textContent).toMatch(/90 degree V-bit.*saved design override/i);
    const clearing = referenceButton('Clear bit');
    expect(clearing.textContent).toMatch(/Ball nose.*saved design override/i);

    act(() => clearing.click());
    expect(host?.querySelector('[role="note"]')?.textContent).toMatch(
      /legacy clearing-bit override.*preserved when you Apply/i,
    );
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('keeps unavailable legacy tool ids visible without silently clearing them', () => {
    const onPatch = vi.fn();
    renderSettings(
      {
        ...DEFAULT_DESIGN_LAYER,
        toolId: 'missing-primary',
        vClearToolId: 'missing-clear',
      },
      onPatch,
    );

    expect(referenceButton('Bit').textContent).toContain('Unavailable bit (missing-primary)');
    const clearing = referenceButton('Clear bit');
    expect(clearing.textContent).toContain('Unavailable bit (missing-clear)');
    act(() => clearing.click());
    expect(host?.querySelector('[role="note"]')?.textContent).toContain(
      'The current cut settings do not use this clearing assignment.',
    );
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('shows a read-only single-stage clearing reference for a flat-floor V-carve', () => {
    renderSettings({
      ...DEFAULT_DESIGN_LAYER,
      cutType: 'v-carve',
      vCarveFlatDepthEnabled: true,
    });

    const clearing = referenceButton('Clear bit');
    expect(clearing.textContent).toContain('Single stage');
    act(() => clearing.click());
    expect(host?.querySelector('[role="note"]')?.textContent).toMatch(
      /Apply the design first.*Startup Setup › Tool Plan/i,
    );
  });

  it('shows the Flat control but hides floor-only controls for flowing V-carve', () => {
    const onPatch = vi.fn();
    renderSettings({ ...DEFAULT_DESIGN_LAYER, cutType: 'v-carve' }, onPatch);

    const flat = host?.querySelector(
      `input[aria-label="Flat depth for ${DEFAULT_DESIGN_LAYER.name}"]`,
    );
    expect(flat).toBeInstanceOf(HTMLInputElement);
    expect((flat as HTMLInputElement).checked).toBe(false);
    expect(host?.textContent).not.toContain('Floor');
    expect(host?.querySelector('button[aria-label^="Clear bit:"]')).toBeNull();

    act(() => {
      (flat as HTMLInputElement).click();
    });
    expect(onPatch).toHaveBeenCalledWith({ vCarveFlatDepthEnabled: true });
  });
});

function renderSettings(layer: DesignLayer, onPatch = vi.fn()): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <DesignLayerSettings
        layer={layer}
        tools={tools}
        activeTool={tools[4]!}
        stockThicknessMm={12}
        onPatch={onPatch}
      />,
    );
  });
}

function referenceButton(label: string): HTMLButtonElement {
  const button = host?.querySelector(`button[aria-label^="${label}:"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} reference missing`);
  return button;
}
