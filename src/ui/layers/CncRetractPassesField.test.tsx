import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, createLayer, type CncLayerSettings } from '../../core/scene';
import { CncRetractPassesField } from './CncRetractPassesField';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const layer = createLayer({ id: 'L1', color: '#ff0000' });

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function renderField(
  settings: CncLayerSettings,
  onCommit: (patch: Partial<CncLayerSettings>) => void,
): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(<CncRetractPassesField layer={layer} settings={settings} onCommit={onCommit} />),
  );
  return host;
}

const withCut = (over: Partial<CncLayerSettings>): CncLayerSettings => ({
  ...DEFAULT_CNC_LAYER_SETTINGS,
  ...over,
});

function checkbox(hostEl: HTMLDivElement): HTMLInputElement | null {
  return hostEl.querySelector('input[type="checkbox"]');
}

describe('CncRetractPassesField', () => {
  it('is checked by default (absent = ON) on a profile-on-path cut', () => {
    const box = checkbox(renderField(withCut({ cutType: 'profile-on-path' }), vi.fn()));
    expect(box?.checked).toBe(true);
  });

  it('reflects an explicit off setting on an engrave cut', () => {
    const box = checkbox(
      renderField(withCut({ cutType: 'engrave', retractBetweenPasses: false }), vi.fn()),
    );
    expect(box?.checked).toBe(false);
  });

  it('renders nothing for cut types that manage their own motion (pocket)', () => {
    expect(checkbox(renderField(withCut({ cutType: 'pocket' }), vi.fn()))).toBeNull();
  });

  it('commits false when toggled off', () => {
    const onCommit = vi.fn();
    const box = checkbox(renderField(withCut({ cutType: 'profile-outside' }), onCommit));
    act(() => {
      box?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith({ retractBetweenPasses: false });
  });
});
