import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRegistrationBoxes, IDENTITY_TRANSFORM, REGISTRATION_LAYER_ID } from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { RegistrationJigPanel } from './RegistrationJigPanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.getState().openRegistrationPanel();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useStore.getState().newProject();
  useUiStore.getState().closeRegistrationPanel();
});

function render(): void {
  act(() => root.render(<RegistrationJigPanel />));
}

function click(label: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (button === undefined) throw new Error(`button not found: ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function addArt(): void {
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
    }),
  );
}

describe('RegistrationJigPanel', () => {
  it('prompts to create a box when no jig exists', () => {
    render();
    expect(container.textContent).toContain('Create a box below to begin');
  });

  it('flips the Next-burn banner and layer output as the Box/Artwork toggle is clicked', () => {
    useStore.getState().addRegistrationBox(80, 40);
    addArt();
    render();

    click('Box only');
    expect(container.textContent).toContain('BOX outline');
    const regLayer = () =>
      useStore.getState().project.scene.layers.find((l) => l.id === REGISTRATION_LAYER_ID);
    expect(regLayer()?.output).toBe(true);

    click('Artwork only');
    expect(container.textContent).toContain('your ARTWORK');
    expect(regLayer()?.output).toBe(false);
  });

  it('locks the box via the Lock box checkbox', () => {
    useStore.getState().addRegistrationBox(80, 40);
    render();
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox === null) throw new Error('lock checkbox not found');
    expect(checkbox.checked).toBe(false);
    act(() => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(findRegistrationBoxes(useStore.getState().project.scene)[0]?.locked).toBe(true);
  });
});
