import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolStrip } from './ToolStrip';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { resetStore } from '../state/test-helpers';
import { loadCompound } from '../state/boolean-compound-workflow.test-fixture';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';

let host: HTMLDivElement, root: Root, styles: HTMLStyleElement;
beforeEach(() => {
  resetStore();
  useUiStore.setState({ toolMode: { kind: 'select' }, modalDepth: 0 });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  styles = document.createElement('style');
  // Use the actual clipping rail and control styles; jsdom cannot qualify
  // physical hit-testing, which the browser regression also exercises.
  const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8');
  styles.textContent = [
    tokens.match(/\.lf-rail \{[^}]*\}/)?.[0] ?? '',
    readFileSync('src/ui/workspace/tool-strip.css', 'utf8'),
    readFileSync('src/ui/common/AnchoredPopover.css', 'utf8'),
  ].join('\n');
  document.head.appendChild(styles);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  styles.remove();
  vi.unstubAllGlobals();
});
function button(label: string): HTMLButtonElement {
  const value = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (value === null) throw new Error(`Missing ${label}`);
  return value;
}
async function pointerActivate(element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.focus();
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
}
function assertRailButton(element: HTMLButtonElement, railWidth = '50px'): void {
  const rail = host.querySelector('.lf-toolstrip');
  expect(element.parentElement).toBe(rail);
  expect(getComputedStyle(element).width).toBe('36px');
  expect(getComputedStyle(rail!).overflowX).toBe('hidden');
  expect(getComputedStyle(rail!).width).toBe(railWidth);
}

describe('compound and node controls in the real clipping ToolStrip', () => {
  it.each([320, 768, 1440])(
    'keeps compound pointer actions inside the rail at viewport width %s',
    async (width) => {
      vi.stubGlobal('innerWidth', width);
      const result = loadCompound('weld');
      const project = useStore.getState().project;
      await act(async () => root.render(<ToolStrip />));
      const edit = button('Edit compound sources');
      assertRailButton(edit);
      assertRailButton(button('Expand compound'));
      await pointerActivate(edit);
      expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
        'Edit Compound Sources',
      );
      expect(useStore.getState().selectedObjectId).toBe(result.id);
      expect(useStore.getState().project).toBe(project);
      const cancel = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent === 'Cancel',
      );
      if (cancel === undefined) throw new Error('Missing Cancel');
      await pointerActivate(cancel);
      await pointerActivate(button('Expand compound'));
      expect(useStore.getState().project.scene.objects[0]).not.toHaveProperty('booleanCompound');
      expect(useStore.getState().selectedObjectId).toBe(result.id);
      await act(async () => useStore.getState().undo());
      expect(useStore.getState().project).toBe(project);
    },
  );
  it('portals numeric fields outside the clipping rail and preserves pointer, Tab and arithmetic edits', async () => {
    const compound = loadCompound();
    useStore.getState().expandBooleanCompound(compound.id, useStore.getState().project);
    useStore
      .getState()
      .selectPathNode({ objectId: compound.id, pathIndex: 0, polylineIndex: 0, pointIndex: 0 });
    useUiStore.getState().setToolMode({ kind: 'node' });
    const project = useStore.getState().project;
    await act(async () => root.render(<ToolStrip />));
    const launcher = button('Node coordinates');
    assertRailButton(launcher, '58px');
    await pointerActivate(launcher);
    const popover = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Node coordinates"]',
    );
    expect(popover?.parentElement).toBe(document.body);
    expect(popover?.closest('.lf-rail')).toBeNull();
    // CSSOM avoids jsdom's :has selector bug for React's colon-containing IDs.
    const popoverRule = [...styles.sheet!.cssRules].find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === '.lf-anchored-popover',
    );
    expect(popover?.classList.contains('lf-anchored-popover')).toBe(true);
    expect(popoverRule?.style.position).toBe('fixed');
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Node X coordinate"]');
    if (input === null) throw new Error('Missing X coordinate');
    await act(async () => Simulate.keyDown(input, { key: 'Tab' }));
    expect(button('Node coordinates').getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      input.value = '1/2in + 2mm';
      Simulate.change(input);
    });
    await act(async () => Simulate.keyDown(input, { key: 'Enter' }));
    expect(useStore.getState().selectedObjectId).toBe(compound.id);
    const edited = useStore.getState().project.scene.objects[0];
    if (edited === undefined || !('paths' in edited) || isBooleanCompoundObject(edited))
      throw new Error('Expected expanded editable paths');
    expect(edited.paths[0]?.polylines[0]?.points[0]?.x).toBeCloseTo(14.7);
    await act(async () => Simulate.keyDown(input, { key: 'Escape' }));
    expect(document.querySelector('[role="dialog"][aria-label="Node coordinates"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    expect(useStore.getState().selectedObjectId).toBe(compound.id);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(project);
  });
});
