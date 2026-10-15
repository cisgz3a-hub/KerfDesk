import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../state/store';
import { resetStore, svgObj } from '../../state/test-helpers';
import { BoardArrayForm } from './BoardArrayForm';
import { findRegistrationBoxes, transformedBBox } from '../../../core/scene';
import { planBoardArray } from '../../../core/scene/board-array-plan';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetStore();
  useStore.getState().importSvgObject(svgObj('art', ['#ff0000']));
  useStore.getState().addCapturedBoardBox(30, 30);
  useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set() });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function edit(label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function applyButton(): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Array on board',
  )!;
}

describe('BoardArrayForm preview', () => {
  it('does not silently turn invalid edge clearance into zero', () => {
    const onArray = vi.fn();
    act(() => root.render(<BoardArrayForm disabled={false} onArray={onArray} />));
    edit('Array edge margin in mm', '-5');
    expect(applyButton().disabled).toBe(true);
    expect(host.textContent).toContain('non-negative spacing and edge margin');
    expect(host.querySelector('svg')).toBeNull();
    act(() => applyButton().click());
    expect(onArray).not.toHaveBeenCalled();
    edit('Array edge margin in mm', '0');
    expect(applyButton().disabled).toBe(false);
  });

  it('shows requested versus fitting copies and updates margin before applying', () => {
    const onArray = vi.fn();
    act(() => root.render(<BoardArrayForm disabled={false} onArray={onArray} />));
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain('4 copies');
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.textContent).toContain('4 fit; 9 requested');
    edit('Array edge margin in mm', '6');
    expect(host.textContent).toContain('1 fit; 9 requested');
    act(() => applyButton().click());
    expect(onArray).toHaveBeenCalledWith({
      kind: 'grid',
      rows: 3,
      cols: 3,
      gapXMm: 2,
      gapYMm: 2,
      marginMm: 6,
    });
    edit('Array edge margin in mm', '11');
    expect(host.textContent).toContain('0 fit; 9 requested');
    expect(applyButton().disabled).toBe(true);
  });

  it('uses exactly the previewed circle plan when the array is applied', () => {
    useStore.getState().addCapturedBoard({ kind: 'circle', diameterMm: 100 });
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set(), undoStack: [] });
    const state = useStore.getState();
    const board = findRegistrationBoxes(state.project.scene)[0]!;
    const original = state.project.scene.objects.find((object) => object.id === 'art')!;
    const footprint = transformedBBox(original);
    const plan = planBoardArray(footprint, board, {
      kind: 'fill',
      gapXMm: 2,
      gapYMm: 2,
      circlePacking: 'rows',
    });
    act(() =>
      root.render(<BoardArrayForm disabled={false} onArray={state.tileSelectionIntoBoard} />),
    );
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain(
      `${plan.offsets.length} copies`,
    );
    act(() => applyButton().click());
    const artwork = useStore
      .getState()
      .project.scene.objects.filter((object) => object.id !== board.id);
    expect(artwork).toHaveLength(plan.offsets.length);
    artwork.forEach((object, index) => {
      const bounds = transformedBBox(object);
      expect(bounds.minX).toBeCloseTo(footprint.minX + plan.offsets[index]!.dx);
      expect(bounds.minY).toBeCloseTo(footprint.minY + plan.offsets[index]!.dy);
    });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('does not change the project when the design cannot fit', () => {
    useStore.getState().addCapturedBoardBox(5, 5);
    useStore.setState({ selectedObjectId: 'art', additionalSelectedIds: new Set(), undoStack: [] });
    const before = useStore.getState().project;
    act(() =>
      root.render(
        <BoardArrayForm disabled={false} onArray={useStore.getState().tileSelectionIntoBoard} />,
      ),
    );
    expect(applyButton().disabled).toBe(true);
    useStore.getState().tileSelectionIntoBoard({ kind: 'fill', gapXMm: 0, gapYMm: 0 });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
  });
});
