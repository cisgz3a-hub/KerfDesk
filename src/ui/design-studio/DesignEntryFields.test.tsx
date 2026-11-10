import { act } from 'react';
import { beforeEach, expect, it } from 'vitest';
import type { SketchLine } from '../../core/design';
import { mountControl } from '../image-editor/control-audit-test-support';
import { NO_MODIFIERS } from './design-draft';
import { useDesignEntryFocus } from './design-entry-focus';
import { createDesignSession } from './design-session';
import { useDesignStudioStore as studio } from './design-studio-store';
import { DesignOptionsBar } from './DesignOptionsBar';

beforeEach(() => {
  studio.setState({ session: { ...createDesignSession(), tool: 'line' }, stash: null });
});

function box(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (input === null) throw new Error(`no ${label} box`);
  return input;
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('stays disabled until a gesture starts, then a canvas digit lands in the first box', async () => {
  const host = await mountControl(<DesignOptionsBar />);
  expect(box(host, 'Draw length in mm').disabled).toBe(true);
  await act(async () =>
    studio.getState().setDraft({
      tool: 'line',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 3, y: 4 },
      modifiers: NO_MODIFIERS,
    }),
  );
  const length = box(host, 'Draw length in mm');
  expect(length.disabled).toBe(false);
  expect(length.value).toBe('5.00');
  await act(async () => useDesignEntryFocus.getState().requestEntryFocus('4'));
  expect(document.activeElement).toBe(length);
  expect(length.value).toBe('4');
  await act(async () => typeInto(length, '40'));
  await act(async () => {
    length.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const entities = studio.getState().session?.history.present.entities ?? [];
  const line = entities[0] as SketchLine;
  expect(line.end.x).toBeCloseTo(24, 9);
  expect(line.end.y).toBeCloseTo(32, 9);
  expect(studio.getState().session?.draft).toBeNull();
});

it('marks a refused value and keeps the gesture untouched', async () => {
  const host = await mountControl(<DesignOptionsBar />);
  await act(async () =>
    studio.getState().setDraft({
      tool: 'line',
      anchorMm: { x: 0, y: 0 },
      pointerMm: { x: 3, y: 4 },
      modifiers: NO_MODIFIERS,
    }),
  );
  const length = box(host, 'Draw length in mm');
  await act(async () => typeInto(length, '0'));
  await act(async () => {
    length.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(length.getAttribute('aria-invalid')).toBe('true');
  expect(studio.getState().session?.draft?.locks).toBeUndefined();
  expect(studio.getState().session?.history.present.entities).toHaveLength(0);
});
