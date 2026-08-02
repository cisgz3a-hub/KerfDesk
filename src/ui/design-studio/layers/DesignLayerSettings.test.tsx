import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DESIGN_LAYER } from '../../../core/design/layers';
import type { CncTool } from '../../../core/scene';
import { useToastStore } from '../../state/toast-store';
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

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('DesignLayerSettings', () => {
  it('offers only flat end mills for V-carve flat-floor clearing', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <DesignLayerSettings
          layer={{ ...DEFAULT_DESIGN_LAYER, cutType: 'v-carve' }}
          tools={tools}
          activeTool={tools[4]!}
          stockThicknessMm={12}
          onPatch={vi.fn()}
        />,
      );
    });

    const clearSelect = [...host.querySelectorAll('select')].find((select) =>
      select.title.startsWith('Two-stage v-carve'),
    );
    if (clearSelect === undefined) throw new Error('clearing bit select missing');
    const optionValues = [...clearSelect.options].map((option) => option.value);

    expect(optionValues).toEqual(['', 'flat']);
    expect(optionValues).not.toContain('ball');
    expect(optionValues).not.toContain('core-box');
    expect(optionValues).not.toContain('engraver');
    expect(optionValues).not.toContain('v90');
    expect(clearSelect.querySelector('optgroup')?.label).toBe('Square / straight end mills');
    expect(clearSelect.querySelector('option[value="flat"]')?.textContent).toBe(
      '3.175 mm, End mill — Flat end mill',
    );
  });

  it('keeps a persisted invalid clearing bit visible but disabled', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <DesignLayerSettings
          layer={{
            ...DEFAULT_DESIGN_LAYER,
            cutType: 'v-carve',
            vClearToolId: 'ball',
          }}
          tools={tools}
          activeTool={tools[4]!}
          stockThicknessMm={12}
          onPatch={vi.fn()}
        />,
      );
    });

    const clearSelect = [...host.querySelectorAll('select')].find((select) =>
      select.title.startsWith('Two-stage v-carve'),
    );
    if (clearSelect === undefined) throw new Error('clearing bit select missing');
    const invalid = clearSelect.querySelector('option[value="ball"]');

    expect(clearSelect.value).toBe('ball');
    expect(invalid).toBeInstanceOf(HTMLOptionElement);
    expect((invalid as HTMLOptionElement).disabled).toBe(true);
    expect(invalid?.textContent).toContain('choose a flat end mill');
    expect(invalid?.textContent).toContain('3.175 mm, Ball nose — Ball nose');
    expect(clearSelect.querySelector('option[value="core-box"]')).toBeNull();
    expect(clearSelect.querySelector('option[value="engraver"]')).toBeNull();
    expect(clearSelect.querySelector('option[value="v90"]')).toBeNull();
  });

  it('warns when Design Studio selects a secondary V-carve clearing bit', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const onPatch = vi.fn();
    act(() => {
      root?.render(
        <DesignLayerSettings
          layer={{ ...DEFAULT_DESIGN_LAYER, cutType: 'v-carve', toolId: 'v90' }}
          tools={tools}
          activeTool={tools[4]!}
          stockThicknessMm={12}
          onPatch={onPatch}
        />,
      );
    });
    const clearSelect = [...host.querySelectorAll('select')].find((select) =>
      select.title.startsWith('Two-stage v-carve'),
    );
    if (clearSelect === undefined) throw new Error('clearing bit select missing');

    act(() => {
      clearSelect.value = 'flat';
      clearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onPatch).toHaveBeenCalledWith({ vClearToolId: 'flat' });
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: expect.stringMatching(/secondary.*feed.*plunge.*RPM.*depth\/pass.*verify/i),
    });
  });
});
