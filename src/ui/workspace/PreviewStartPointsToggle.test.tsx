import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import type { PreviewToolpath } from './preview-status';
import { PreviewStartPointsToggle } from './PreviewStartPointsToggle';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const initial = useUiStore.getState().showPreviewStartPoints;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUiStore.setState({ showPreviewStartPoints: initial });
});

async function render(toolpath: PreviewToolpath): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<PreviewStartPointsToggle toolpath={toolpath} />));
  return host;
}

const MARKED: PreviewToolpath = {
  steps: [],
  totalLength: 0,
  cutStartMarkers: [{ at: { x: 1, y: 2 }, direction: { x: 1, y: 0 }, operatorSet: false }],
};

describe('PreviewStartPointsToggle', () => {
  it('starts off and switches the preview marks on', async () => {
    expect(initial).toBe(false);
    const view = await render(MARKED);
    const box = view.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    await act(async () => box?.click());
    expect(useUiStore.getState().showPreviewStartPoints).toBe(true);
  });

  it('stays out of previews with no closed cut to mark', async () => {
    const view = await render({ steps: [], totalLength: 0 });
    expect(view.querySelector('input')).toBeNull();
  });
});
