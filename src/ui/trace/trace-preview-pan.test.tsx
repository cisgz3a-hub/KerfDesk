import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  click,
  mountNavigationPreview,
  mouse,
  pointer,
  previewHost,
  stage,
  unmountNavigationPreview,
  viewport,
  type BoundaryListener,
} from './trace-preview-navigation.test-support';

let onBoundaryChange: Mock<BoundaryListener>;

beforeEach(async () => {
  onBoundaryChange = vi.fn<BoundaryListener>();
  await mountNavigationPreview(onBoundaryChange);
});

afterEach(unmountNavigationPreview);

describe('TracePreview drag to pan', () => {
  it('pans by middle-drag and suppresses middle-button autoscroll', async () => {
    await click('Zoom in');
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([150, 100]);
    await pointer('pointerdown', { id: 7, button: 1, x: 100, y: 100 });
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    await act(async () => stage().dispatchEvent(mouseDown));
    expect(mouseDown.defaultPrevented).toBe(true);
    expect(viewport().dataset['pan']).toBe('panning');
    await pointer('pointermove', { id: 7, button: 1, x: 80, y: 90 });
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([170, 110]);
    await pointer('pointerup', { id: 7, button: 1, x: 80, y: 90 });
    expect(viewport().dataset['pan']).toBe('idle');
    expect(onBoundaryChange).not.toHaveBeenCalled();
  });

  it('pans by Space+drag instead of drawing a Boundary, then primary drag draws again', async () => {
    await click('Zoom in');
    await pointer('pointerenter', { id: 1, x: 10, y: 10 });
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => document.body.dispatchEvent(space));
    expect(space.defaultPrevented).toBe(true);
    expect(viewport().dataset['pan']).toBe('ready');
    await pointer('pointerdown', { id: 1, button: 0, x: 100, y: 100 });
    await mouse('mousedown', 100, 100);
    await pointer('pointermove', { id: 1, button: 0, x: 60, y: 70 });
    await mouse('mousemove', 60, 70);
    expect(previewHost().querySelector('[aria-label="Trace boundary"]')).toBeNull();
    await pointer('pointerup', { id: 1, button: 0, x: 60, y: 70 });
    await mouse('mouseup', 60, 70);
    expect([viewport().scrollLeft, viewport().scrollTop]).toEqual([190, 130]);
    expect(onBoundaryChange).not.toHaveBeenCalled();
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })),
    );
    expect(viewport().dataset['pan']).toBe('idle');

    await pointer('pointerdown', { id: 1, button: 0, x: 30, y: 20 });
    await mouse('mousedown', 30, 20);
    await mouse('mousemove', 90, 80);
    await mouse('mouseup', 90, 80);
    expect(onBoundaryChange).toHaveBeenCalledTimes(1);
    expect(viewport().scrollLeft).toBe(190);
  });

  it('does not claim Space typed into a text field', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      await pointer('pointerenter', { id: 1, x: 10, y: 10 });
      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      await act(async () => input.dispatchEvent(space));
      expect(space.defaultPrevented).toBe(false);
      expect(viewport().dataset['pan']).toBe('idle');
    } finally {
      input.remove();
    }
  });

  it.each([
    ['a checkbox', () => Object.assign(document.createElement('input'), { type: 'checkbox' })],
    ['a button', () => document.createElement('button')],
    [
      'a role=switch control',
      () => {
        const control = document.createElement('div');
        control.setAttribute('role', 'switch');
        control.tabIndex = 0;
        return control;
      },
    ],
  ])('leaves Space to %s focused while the pointer rests over the preview', async (_, make) => {
    const control: HTMLElement = make();
    document.body.appendChild(control);
    try {
      control.focus();
      await pointer('pointerenter', { id: 1, x: 10, y: 10 });
      const down = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      await act(async () => control.dispatchEvent(down));
      const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
      await act(async () => control.dispatchEvent(up));
      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      expect(viewport().dataset['pan']).toBe('idle');
    } finally {
      control.remove();
    }
  });

  it('claims Space on the focused viewport even without hover', async () => {
    viewport().focus();
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => viewport().dispatchEvent(space));
    expect(space.defaultPrevented).toBe(true);
    expect(viewport().dataset['pan']).toBe('ready');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(viewport().dataset['pan']).toBe('idle');
  });

  it('ends a mouse pan whose button-up was lost, so hover never pans and Boundary works', async () => {
    await click('Zoom in');
    await pointer('pointerdown', { id: 7, button: 1, x: 100, y: 100 });
    expect(viewport().dataset['pan']).toBe('panning');
    const left = viewport().scrollLeft;
    // Released outside the window: the next move arrives with no button held.
    await pointer('pointermove', { id: 7, button: -1, buttons: 0, x: 60, y: 60 });
    expect(viewport().dataset['pan']).toBe('idle');
    expect(viewport().scrollLeft).toBe(left);
    await pointer('pointermove', { id: 7, button: -1, buttons: 0, x: 20, y: 20 });
    expect(viewport().scrollLeft).toBe(left);
    await pointer('pointerdown', { id: 7, button: 0, x: 30, y: 20 });
    await mouse('mousedown', 30, 20);
    await mouse('mousemove', 90, 80);
    await mouse('mouseup', 90, 80);
    expect(onBoundaryChange).toHaveBeenCalledTimes(1);
  });

  it('ends a mouse pan on window blur and on lost pointer capture', async () => {
    await pointer('pointerdown', { id: 7, button: 1, x: 100, y: 100 });
    expect(viewport().dataset['pan']).toBe('panning');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(viewport().dataset['pan']).toBe('idle');
    await pointer('pointerdown', { id: 8, button: 1, x: 100, y: 100 });
    expect(viewport().dataset['pan']).toBe('panning');
    await pointer('lostpointercapture', { id: 8, button: 1, buttons: 0, x: 100, y: 100 });
    expect(viewport().dataset['pan']).toBe('idle');
  });
});
