import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintAndCutDialog } from './PrintAndCutDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('PrintAndCutDialog', () => {
  it('enables Apply only for two distinct design and machine point pairs', () => {
    const onApply = vi.fn();
    act(() =>
      root.render(
        <PrintAndCutDialog
          initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
          firstMachinePoint={{ x: 20, y: 30 }}
          secondMachinePoint={{ x: 120, y: 30 }}
          captureEnabled={true}
          onCapture={vi.fn()}
          onCancel={vi.fn()}
          onApply={onApply}
          onDisable={vi.fn()}
        />,
      ),
    );
    const apply = buttonByText(host, 'Apply registration');
    expect(apply.disabled).toBe(false);

    const secondX = host.querySelectorAll<HTMLInputElement>('input[type="number"]').item(2);
    act(() => {
      secondX.value = '0';
      Simulate.change(secondX);
    });
    expect(apply.disabled).toBe(true);
    expect(host.textContent).toContain('Registration targets must be distinct.');
    act(() => apply.click());
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps Apply disabled until both machine points are captured', () => {
    act(() =>
      root.render(
        <PrintAndCutDialog
          initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
          firstMachinePoint={{ x: 20, y: 30 }}
          secondMachinePoint={null}
          captureEnabled={true}
          onCapture={vi.fn()}
          onCancel={vi.fn()}
          onApply={vi.fn()}
          onDisable={vi.fn()}
        />,
      ),
    );
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
    expect(host.textContent).toContain('Capture both machine registration points.');
  });
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  return button;
}
