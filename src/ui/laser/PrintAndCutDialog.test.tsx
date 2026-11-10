import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintAndCutDialog, type PrintAndCutCamera } from './PrintAndCutDialog';

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

  it('shows the captured scale and turn, and applies an unusual one only once confirmed', () => {
    const onApply = vi.fn();
    const render = (second: { x: number; y: number }) =>
      act(() =>
        root.render(
          <PrintAndCutDialog
            initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
            firstMachinePoint={{ x: 20, y: 30 }}
            secondMachinePoint={second}
            captureEnabled={true}
            onCapture={vi.fn()}
            onCancel={vi.fn()}
            onApply={onApply}
            onDisable={vi.fn()}
          />,
        ),
      );
    render({ x: 120, y: 30 });
    expect(host.textContent).toContain(
      'The captured points are 100.0 mm apart (designed 100.0 mm, print scale +0.00 %), turned 0.0°.',
    );
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();

    // A jog that slipped 3 mm: 3 % larger than designed.
    render({ x: 123, y: 30 });
    const apply = buttonByText(host, 'Apply registration');
    expect(host.textContent).toContain('print scale +3.00 %');
    expect(host.textContent).toContain('A print scale more than 2 % off is not the printer');
    expect(apply.disabled).toBe(true);
    const confirm = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (confirm === null) throw new Error('confirmation missing');
    act(() => confirm.click());
    expect(apply.disabled).toBe(false);

    // Another capture asks again.
    render({ x: 124, y: 30 });
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    act(() => buttonByText(host, 'Apply registration').click());
    expect(onApply).toHaveBeenCalledWith({ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } });
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

describe('PrintAndCutDialog targets from the selection and marks from the camera', () => {
  const camera = (overrides: Partial<PrintAndCutCamera> = {}): PrintAndCutCamera => ({
    offered: true,
    available: true,
    finding: false,
    message: null,
    onFind: vi.fn(),
    ...overrides,
  });
  const render = (props: Partial<Parameters<typeof PrintAndCutDialog>[0]> = {}): void =>
    act(() =>
      root.render(
        <PrintAndCutDialog
          initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
          firstMachinePoint={null}
          secondMachinePoint={null}
          captureEnabled={false}
          onCapture={vi.fn()}
          onCancel={vi.fn()}
          onApply={vi.fn()}
          onDisable={vi.fn()}
          {...props}
        />,
      ),
    );
  const designInputs = (): string[] =>
    [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
      (input) => input.value,
    );

  it('sets both targets to the selected marks, or says to select them first', () => {
    render({ selectionTargets: null });
    act(() => buttonByText(host, 'Use selected marks').click());
    expect(host.textContent).toContain('Select the two marks in the design first');
    expect(designInputs()).toEqual(['0', '0', '100', '0']);

    render({ selectionTargets: { first: { x: 12.5, y: 20 }, second: { x: 272.5, y: 20 } } });
    act(() => buttonByText(host, 'Use selected marks').click());
    expect(designInputs()).toEqual(['12.5', '20', '272.5', '20']);
  });

  it('shows the camera row only with a saved camera model', () => {
    render();
    expect(host.textContent).not.toContain('Find marks with camera');
    render({ camera: camera({ offered: false, available: false }) });
    expect(host.textContent).not.toContain('Find marks with camera');
  });

  it('needs a live camera to search, and says how to get one', () => {
    render({ camera: camera({ available: false }) });
    expect(buttonByText(host, 'Find marks with camera').disabled).toBe(true);
    expect(host.textContent).toContain('Turn the camera on in the Camera panel');
  });

  it('searches for the targets as edited, and shows what the camera found', () => {
    const onFind = vi.fn();
    render({ camera: camera({ onFind }) });
    const secondX = host.querySelectorAll<HTMLInputElement>('input[type="number"]').item(2);
    act(() => {
      secondX.value = '260';
      Simulate.change(secondX);
    });
    act(() => buttonByText(host, 'Find marks with camera').click());
    expect(onFind).toHaveBeenCalledWith({ first: { x: 0, y: 0 }, second: { x: 260, y: 0 } });

    render({ camera: camera({ finding: true }) });
    expect(buttonByText(host, 'Finding marks').disabled).toBe(true);

    render({
      firstMachinePoint: { x: 71.234, y: 72.5 },
      secondMachinePoint: { x: 331, y: 104 },
      firstSource: 'camera',
      secondSource: 'head',
      camera: camera({ message: 'The camera found both marks 260.5 mm apart.' }),
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'The camera found both marks 260.5 mm apart.',
    );
    expect(host.textContent).toContain('Camera 71.23, 72.50');
    expect(host.textContent).toContain('Machine 331.000, 104.000');
  });
});

describe('unusual registration acknowledgement ownership', () => {
  const first = { x: 20, y: 30 };
  const second = { x: 123, y: 30 };
  const render = (a = first, b = second): void =>
    act(() =>
      root.render(
        <PrintAndCutDialog
          initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
          firstMachinePoint={a}
          secondMachinePoint={b}
          captureEnabled={true}
          onCapture={vi.fn()}
          onCancel={vi.fn()}
          onApply={vi.fn()}
          onDisable={vi.fn()}
        />,
      ),
    );
  const acknowledge = (): void => {
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox === null) throw new Error('unusual registration acknowledgement missing');
    act(() => checkbox.click());
    expect(buttonByText(host, 'Apply registration').disabled).toBe(false);
  };

  it('retains acknowledgement while the same targets and captures are displayed again', () => {
    render();
    acknowledge();
    render();
    expect(buttonByText(host, 'Apply registration').disabled).toBe(false);
  });

  it('asks again after both captures translate even when scale and turn return to the same figures', () => {
    render();
    acknowledge();
    const translatedFirst = { x: 120, y: 130 };
    render(translatedFirst, second);
    render(translatedFirst, { x: 223, y: 130 });
    expect(host.textContent).toContain('print scale +3.00 %), turned 0.0°');
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
  });

  it('asks again when a new capture changes by less than the displayed precision', () => {
    render();
    acknowledge();
    render(first, { x: 123.001, y: 30 });
    expect(host.textContent).toContain('103.0 mm apart (designed 100.0 mm, print scale +3.00 %');
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
  });

  it('asks again for a fresh capture even when its coordinates repeat', () => {
    render();
    acknowledge();
    render(first, { ...second });
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
  });

  it('asks again when a design target changes by less than the displayed precision', () => {
    render();
    acknowledge();
    const firstX = host.querySelectorAll<HTMLInputElement>('input[type="number"]').item(0);
    act(() => {
      firstX.value = '0.001';
      Simulate.change(firstX);
    });
    expect(host.textContent).toContain('103.0 mm apart (designed 100.0 mm, print scale +3.00 %');
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
  });
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button missing`);
  return button;
}

// Rolling audit v13 Y3-P2-1 (ADR-443 Amendment 3): the camera could not tell
// which way round the sheet lies, so the operator confirms before Apply.
describe('camera orientation note', () => {
  it('holds Apply until the operator confirms the turn the camera could not settle', () => {
    const onApply = vi.fn();
    act(() =>
      root.render(
        <PrintAndCutDialog
          initialTargets={{ first: { x: 0, y: 0 }, second: { x: 100, y: 0 } }}
          firstMachinePoint={{ x: 20, y: 30 }}
          secondMachinePoint={{ x: 20, y: 130 }}
          captureEnabled={true}
          orientationNote="The camera could not tell which way round the sheet lies."
          onCapture={vi.fn()}
          onCancel={vi.fn()}
          onApply={onApply}
          onDisable={vi.fn()}
        />,
      ),
    );
    expect(host.textContent).toContain('The camera could not tell which way round the sheet lies.');
    expect(buttonByText(host, 'Apply registration').disabled).toBe(true);
    const confirm = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (confirm === null) throw new Error('confirmation missing');
    act(() => confirm.click());
    expect(buttonByText(host, 'Apply registration').disabled).toBe(false);
    act(() => buttonByText(host, 'Apply registration').click());
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
