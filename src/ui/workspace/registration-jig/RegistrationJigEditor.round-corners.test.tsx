// A rounded rectangle on a jig keeps the corner radius it was drawn with
// (ADR-144 Amendment 1, rolling audit v8 N3-P1-3). The jig editor's shared
// artwork size and its Centre fit wrote a plain transform scale: an r 3
// rectangle typed to 40 × 10 burned 6 × 3 mm corners, and Centre burned r 8.1.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileJob } from '../../../core/job';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  transformedBBox,
  type Project,
  type Vec2,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { useStore } from '../../state';
import { RegistrationJigEditor } from './RegistrationJigEditor';

vi.mock('./RegistrationJigCanvas', () => ({
  RegistrationJigCanvas: (props: { project: Project }) => (
    <div aria-label="Registration jig editing canvas">
      {props.project.scene.objects.map((object) => object.id).join(' ')}
    </div>
  ),
}));
vi.mock('./JigArtworkImport', () => ({
  JigArtworkImport: () => <div>Import artwork</div>,
  useJigArtworkImport: () => ({ busy: false, importFiles: async () => undefined }),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Centre fits 20 × 10 into 90 % of a 60 × 40 outline: 2.7 times, 54 × 27.
const FITTED = { width: 54, height: 27 };
const ROUND_R3 = { alongX: 3, alongY: 3 };
const ON_EDGE_MM = 1e-6;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.getState().newProject();
  useStore.getState().replaceRegistrationJigSet({
    outline: { kind: 'rectangle', widthMm: 60, heightMm: 40 },
    rows: 1,
    columns: 2,
    spacingX: 10,
    spacingY: 0,
  });
  const outline = transformedBBox(findRegistrationBoxes(useStore.getState().project.scene)[0]!);
  useStore.getState().drawShape(
    createRectangle({
      id: 'art',
      color: '#0000ff',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 3 },
      transform: { ...IDENTITY_TRANSFORM, x: outline.minX + 5, y: outline.minY + 5 },
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('a rounded rectangle on a jig keeps its corners (ADR-144 Amendment 1)', () => {
  it('Centre + copy keeps r 3 at the fitted size', () => {
    openJigEditorWithArtworkSelected();
    click('Centre + copy artwork to all 2');
    click('Save to canvas');

    expect(burnedArtwork()).toEqual([
      { ...FITTED, ...ROUND_R3 },
      { ...FITTED, ...ROUND_R3 },
    ]);
  });

  it('the shared artwork size typed to 40 × 10 keeps r 3 on every copy', () => {
    openJigEditorWithArtworkSelected();
    click('Centre + copy artwork to all 2');
    click('AR locked');
    type('Jig artwork width', '40');
    type('Jig artwork height', '10');
    click('Apply size to all 2');
    click('Save to canvas');

    expect(burnedArtwork()).toEqual([
      { width: 40, height: 10, ...ROUND_R3 },
      { width: 40, height: 10, ...ROUND_R3 },
    ]);
  });

  it('the main canvas Centre and shared size keep r 3, locked and unlocked', () => {
    const store = useStore.getState();
    store.centerSelectionInRegistrationBox();
    expect(burnedArtwork()).toEqual([
      { ...FITTED, ...ROUND_R3 },
      { ...FITTED, ...ROUND_R3 },
    ]);

    expect(
      store.resizeRegistrationJigArtwork({
        widthMm: 40,
        heightMm: 10,
        drivingDimension: 'width',
        preserveAspect: false,
      }),
    ).toEqual({ kind: 'ok' });
    expect(burnedArtwork()).toEqual([
      { width: 40, height: 10, ...ROUND_R3 },
      { width: 40, height: 10, ...ROUND_R3 },
    ]);

    store.resizeRegistrationJigArtwork({
      widthMm: 80,
      heightMm: 20,
      drivingDimension: 'width',
      preserveAspect: true,
    });
    expect(burnedArtwork()).toEqual([
      { width: 80, height: 20, ...ROUND_R3 },
      { width: 80, height: 20, ...ROUND_R3 },
    ]);
  });
});

function openJigEditorWithArtworkSelected(): void {
  useStore.getState().setRegistrationBoxLocked(true);
  act(() => root.render(<RegistrationJigEditor onClose={() => undefined} />));
  const editor = container.querySelector('[aria-label="Registration Jig editor"]');
  if (editor === null) throw new Error('Missing editor');
  act(() => {
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
}

function click(label: string): void {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (found === undefined) throw new Error(`Missing ${label}`);
  act(() => found.click());
}

function type(label: string, value: string): void {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  if (field === null) throw new Error(`Missing ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

type BurnedRectangle = {
  readonly width: number;
  readonly height: number;
  readonly alongX: number;
  readonly alongY: number;
};

// The artwork cuts the jig's artwork run compiles. alongX and alongY are how
// far each rounded corner reaches along the edges: the straight bottom edge
// starts alongX in from the box corner, the straight left edge alongY up.
function burnedArtwork(): ReadonlyArray<BurnedRectangle> {
  useStore.getState().setRegistrationOutput('artwork');
  const { project } = useStore.getState();
  expect(project.scene.objects.filter((object) => !isRegistrationBox(object))).toHaveLength(2);
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'cut' ? group.segments.map((segment) => burnedRectangle(segment.polyline)) : [],
  );
}

function burnedRectangle(polyline: ReadonlyArray<Vec2>): BurnedRectangle {
  const xs = polyline.map((point) => point.x);
  const ys = polyline.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const onBottom = polyline.filter((point) => Math.abs(point.y - minY) < ON_EDGE_MM);
  const onLeft = polyline.filter((point) => Math.abs(point.x - minX) < ON_EDGE_MM);
  return {
    width: rounded(Math.max(...xs) - minX),
    height: rounded(Math.max(...ys) - minY),
    alongX: rounded(Math.min(...onBottom.map((point) => point.x)) - minX),
    alongY: rounded(Math.min(...onLeft.map((point) => point.y)) - minY),
  };
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}
