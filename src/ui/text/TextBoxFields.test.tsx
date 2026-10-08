import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { TextBoxFields } from './TextBoxFields';
import { useTextDialogFields, type DialogFields } from './use-text-dialog-fields';
vi.mock('./render-text-geometry', () => ({
  renderTextGeometry: vi.fn(async () => ({
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    paths: [],
    textBoxLayout: {
      content: 'A',
      sizeMm: 2,
      widthMm: 60,
      heightMm: 30,
      lineCount: 1,
      advanceWidthMm: 5,
      overflow: false,
    },
  })),
}));
let host: HTMLDivElement, root: Root, fields: DialogFields;
const original: TextBoxSettings = {
  mode: 'auto-height',
  widthMm: 45,
  heightMm: 20,
  wrap: true,
  fit: 'none',
  minSizeMm: 2,
};
function Harness(): JSX.Element {
  fields = useTextDialogFields(
    {
      mode: 'edit',
      id: 'text',
      content: 'A',
      fontKey: 'roboto-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color: '#000000',
      textBox: original,
    },
    createProject(),
    null,
  );
  return <TextBoxFields fields={fields} />;
}
beforeEach(async () => {
  resetStore();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe('editable text frame controls', () => {
  it('restores the saved frame, accepts unit arithmetic and leaves the project untouched', async () => {
    const before = useStore.getState().project;
    expect(fields.values.textBox).toEqual(original);
    const width = host.querySelector<HTMLInputElement>('[aria-label="Text box Width (mm)"]')!;
    await act(async () => {
      width.value = '1/2in';
      Simulate.change(width);
    });
    await act(async () => Simulate.keyDown(width, { key: 'Enter' }));
    expect(fields.values.textBox?.widthMm).toBe(12.7);
    await act(async () => {
      width.value = '1/0';
      Simulate.change(width);
    });
    await act(async () => Simulate.blur(width));
    expect(fields.values.textBox?.widthMm).toBe(12.7);
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
  it('chooses a single editable placement mode when switching to bend or path text', async () => {
    await act(async () => fields.setBendDeg(30));
    expect(fields.values.textBox).toBeUndefined();
    await act(async () => fields.setTextBox(original));
    expect(fields.values.bendDeg).toBe(0);
    await act(async () => fields.setPathEnabled(true));
    expect(fields.values.textBox).toBeUndefined();
    await act(async () => fields.setTextBox(original));
    expect(fields.pathEnabled).toBe(false);
  });
});
