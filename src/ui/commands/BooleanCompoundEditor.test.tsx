import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createLayer, type ImportedSvg } from '../../core/scene';
import { compoundRectangle, compoundArea } from '../../core/geometry/boolean-compound.test-fixture';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { BooleanCompoundControls } from '../workspace/BooleanCompoundControls';
import { BooleanDialogHost } from './BooleanDialogHost';
import { openBooleanDialog, useBooleanDialogStore } from './boolean-dialog-store';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  setActiveEdition(UNRESTRICTED_EDITION);
  useBooleanDialogStore.setState({ session: null });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  setActiveEdition(null);
});
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === label || entry.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(label);
  return found;
}
function input(label: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(label);
  return found;
}
async function enter(label: string, text: string): Promise<void> {
  const field = input(label);
  await act(async () => {
    field.value = text;
    Simulate.change(field);
  });
  await act(async () => Simulate.blur(field));
}
async function choose(label: string, value: string): Promise<void> {
  const field = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (field === null) throw new Error(label);
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}
function result(): ImportedSvg & {
  readonly booleanCompound: NonNullable<ImportedSvg['booleanCompound']>;
} {
  const object = useStore.getState().project.scene.objects[0];
  if (object === undefined || !isBooleanCompoundObject(object)) throw new Error('Missing compound');
  return object;
}
async function create(
  operation: 'subtract' | 'intersect' = 'subtract',
  curves = false,
): Promise<void> {
  const subject = compoundRectangle('subject');
  const clip = compoundRectangle('clip', 5);
  const source = curves
    ? {
        ...subject,
        paths: [
          {
            ...subject.paths[0]!,
            curves: [
              {
                start: { x: 0, y: 0 },
                closed: true,
                segments: [
                  {
                    kind: 'cubic' as const,
                    control1: { x: 3, y: 0 },
                    control2: { x: 7, y: 0 },
                    to: { x: 10, y: 0 },
                  },
                  { kind: 'line' as const, to: { x: 10, y: 10 } },
                  { kind: 'line' as const, to: { x: 0, y: 10 } },
                  { kind: 'line' as const, to: { x: 0, y: 0 } },
                ],
              },
            ],
          },
        ],
      }
    : subject;
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [source, clip],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'subject',
    additionalSelectedIds: new Set(['clip']),
  });
  await act(async () => {
    root.render(
      <>
        <BooleanDialogHost />
        <BooleanCompoundControls />
      </>,
    );
    openBooleanDialog(operation);
  });
  const check = [...host.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Create live compound'))
    ?.querySelector<HTMLInputElement>('input');
  if (check === undefined || check === null) throw new Error('Compound option');
  await act(async () => {
    check.checked = true;
    Simulate.change(check);
  });
  await act(async () => button('Apply').click());
  expect(result().booleanCompound.operation).toBe(operation);
}
async function edit(): Promise<void> {
  await act(async () => button('Edit compound sources').click());
}
describe('live compound source editing UI', () => {
  it('captures editable sources, updates node geometry live, and applies one undo transaction', async () => {
    await create();
    const original = result();
    const project = useStore.getState().project;
    const layers = project.scene.layers;
    await edit();
    await choose('Retained compound source', '1');
    const before = host.querySelector('[data-testid="comparison-result"]')?.getAttribute('d');
    await enter('Source node X (mm)', '1+1mm');
    expect(useStore.getState().project).toBe(project);
    expect(host.querySelector('[data-testid="comparison-result"]')?.getAttribute('d')).not.toBe(
      before,
    );
    await act(async () => button('Apply').click());
    const edited = result();
    expect(edited.id).toBe(original.id);
    expect(edited.booleanCompound.operands[1]?.object.paths[0]?.polylines[0]?.points[0]).toEqual({
      x: 2,
      y: 0,
    });
    expect(compoundArea(edited)).toBe(60);
    expect(useStore.getState().project.scene.layers).toBe(layers);
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(project);
  });
  it('edits retained canonical cubic controls without flattening the source', async () => {
    await create('subtract', true);
    const project = useStore.getState().project;
    await edit();
    await enter('Source node number', '2');
    await choose('Source point kind', 'incoming');
    await enter('Source node Y (mm)', '3');
    expect(useStore.getState().project).toBe(project);
    await act(async () => button('Apply').click());
    const curve = result().booleanCompound.operands[0]?.object.paths[0]?.curves?.[0];
    expect(curve?.segments[0]).toMatchObject({ kind: 'cubic', control2: { x: 7, y: 3 } });
    expect(result().booleanCompound.operands[0]?.object.paths[0]?.curves).toHaveLength(1);
  });
  it('refuses an empty preview, and Cancel discards all source edits', async () => {
    await create('intersect');
    const project = useStore.getState().project;
    await edit();
    await choose('Retained compound source', '1');
    await enter('Source X (mm)', '20');
    expect(button('Apply').disabled).toBe(true);
    expect(host.textContent).toContain('result is empty');
    await act(async () => button('Cancel').click());
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
  it('invalidates an editor after another project mutation and expands explicitly with Undo', async () => {
    await create();
    await edit();
    const object = result();
    await act(async () =>
      useStore.getState().setObjectTransform(object.id, { ...object.transform, x: 10 }),
    );
    expect(button('Apply').disabled).toBe(true);
    expect(host.textContent).toContain('project changed');
    await act(async () => button('Cancel').click());
    const project = useStore.getState().project;
    await act(async () => button('Expand compound').click());
    expect(useStore.getState().project.scene.objects[0]).not.toHaveProperty('booleanCompound');
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project).toBe(project);
    expect(button('Edit compound sources').disabled).toBe(false);
  });
});
