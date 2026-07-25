import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Viewer3DToolbar } from './Viewer3DToolbar';
import { DISPLAY_MODE_CHOICES, type Viewer3DDisplayMode } from './viewer3d-display-mode';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderToolbar(overrides?: {
  readonly mode?: Viewer3DDisplayMode;
  readonly onModeChange?: (mode: Viewer3DDisplayMode) => void;
  readonly onSectionChange?: (fraction: number) => void;
  readonly onSavePng?: () => void;
}): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <Viewer3DToolbar
        mode={overrides?.mode ?? { kind: 'shaded-toolpath' }}
        onModeChange={overrides?.onModeChange ?? vi.fn()}
        sectionFraction={1}
        onSectionChange={overrides?.onSectionChange ?? vi.fn()}
        onSavePng={overrides?.onSavePng ?? vi.fn()}
      />,
    );
  });
  return host;
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  if (match === undefined) throw new Error(`no button labelled ${label}`);
  return match;
}

// React installs its own value tracker on controlled inputs, so assigning
// .value directly is seen as "no change" and onChange never fires. Going
// through the prototype's setter is what makes the tracker notice.
function setRangeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Viewer3DToolbar', () => {
  it('marks exactly one mode pressed', () => {
    const container = renderToolbar({ mode: { kind: 'xray' } });
    const pressed = [...container.querySelectorAll('button[aria-pressed="true"]')];
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toBe('X-ray');
  });

  it('offers a button for every display mode', () => {
    // A union arm with no button is unreachable from the UI.
    const container = renderToolbar();
    for (const choice of DISPLAY_MODE_CHOICES) {
      expect(buttonByLabel(container, choice.label)).toBeTruthy();
    }
  });

  it('reports the chosen mode rather than a label string', () => {
    // The callback carries the union value, so the page never has to map a
    // label back to a mode — that mapping is exactly where a typo survives.
    const onModeChange = vi.fn();
    const container = renderToolbar({ onModeChange });
    act(() => buttonByLabel(container, 'Path').click());
    expect(onModeChange).toHaveBeenCalledWith({ kind: 'toolpath' });
  });

  it('reports the section position as a number, not the input string', () => {
    const onSectionChange = vi.fn();
    const container = renderToolbar({ onSectionChange });
    const slider = container.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    act(() => {
      if (slider instanceof HTMLInputElement) setRangeValue(slider, '0.4');
    });
    expect(onSectionChange).toHaveBeenCalledWith(0.4);
  });

  it('fires the PNG export', () => {
    const onSavePng = vi.fn();
    const container = renderToolbar({ onSavePng });
    act(() => buttonByLabel(container, 'Save PNG').click());
    expect(onSavePng).toHaveBeenCalledTimes(1);
  });
});
