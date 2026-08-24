import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, isRegistrationBox, transformedBBox } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { RegistrationJigArtworkSizeControls } from './RegistrationJigArtworkSizeControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.getState().newProject();
  useStore.getState().replaceRegistrationJigSet({
    outline: { kind: 'rectangle', widthMm: 50, heightMm: 40 },
    rows: 1,
    columns: 2,
    spacingX: 10,
    spacingY: 0,
  });
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
    }),
  );
  useStore.getState().centerSelectionInRegistrationBox();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<RegistrationJigArtworkSizeControls />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useStore.getState().newProject();
});

describe('RegistrationJigArtworkSizeControls', () => {
  it('keeps the other dimension unchanged while aspect ratio is unlocked', () => {
    expect(buttonByLabel('AR locked').getAttribute('aria-pressed')).toBe('true');
    clickButton('AR locked');
    expect(buttonByLabel('AR unlocked').getAttribute('aria-pressed')).toBe('false');

    const width = inputByLabel('Jig artwork width');
    const height = inputByLabel('Jig artwork height');
    const originalHeight = height.value;
    setInputValue(width, '30');
    expect(height.value).toBe(originalHeight);

    setInputValue(height, '10');
    expect(width.value).toBe('30');
    clickButton('Apply size to all 2');

    const artwork = useStore
      .getState()
      .project.scene.objects.filter((object) => !isRegistrationBox(object));
    for (const object of artwork) {
      const bounds = transformedBBox(object);
      expect(bounds.maxX - bounds.minX).toBeCloseTo(30);
      expect(bounds.maxY - bounds.minY).toBeCloseTo(10);
    }
  });
});

function inputByLabel(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`input not found: ${label}`);
  return input;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (button === undefined) throw new Error(`button not found: ${label}`);
  return button;
}

function clickButton(label: string): void {
  act(() => buttonByLabel(label).click());
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('native value setter not found');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
