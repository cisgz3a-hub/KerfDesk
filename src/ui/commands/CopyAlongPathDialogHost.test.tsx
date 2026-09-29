import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyAlongPathLayout } from '../../core/geometry/copy-along-path';
import type * as CopyAlongPath from '../../core/geometry/copy-along-path';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../../core/scene/scene-object';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  openCopyAlongPathDialog,
  useCopyAlongPathDialogStore,
} from './copy-along-path-dialog-store';
import { CopyAlongPathDialogHost, resetCopyAlongPathDialogMemory } from './CopyAlongPathDialogHost';

// Counts how often the copies are laid out; the real layout still runs.
vi.mock('../../core/geometry/copy-along-path', async (importOriginal) => {
  const actual = await importOriginal<typeof CopyAlongPath>();
  return { ...actual, copyAlongPathLayout: vi.fn(actual.copyAlongPathLayout) };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  resetCopyAlongPathDialogMemory();
  vi.mocked(copyAlongPathLayout).mockClear();
  useCopyAlongPathDialogStore.setState({ open: false });
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function poly(points: ReadonlyArray<readonly [number, number]>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function svg(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
  };
}

// Two triangles 15 mm across: artwork that can never be the guide.
const LOGO: ImportedSvg = {
  ...svg('logo', [
    poly(
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 0],
      ],
      true,
    ),
    poly(
      [
        [10, 0],
        [15, 0],
        [15, 5],
        [10, 0],
      ],
      true,
    ),
  ]),
  bounds: { minX: 0, minY: 0, maxX: 15, maxY: 5 },
};
const LINE = svg('rail', [
  poly([
    [0, 50],
    [100, 50],
  ]),
]);
const RING = svg('ring', [
  poly(
    [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
      [0, 0],
    ],
    true,
  ),
]);

async function open(objects: ReadonlyArray<ImportedSvg>): Promise<void> {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects, layers: [createLayer({ id: 'cut', color: '#000000' })], groups: [] },
    },
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
  });
  await act(async () => root.render(<CopyAlongPathDialogHost />));
  await act(async () => openCopyAlongPathDialog());
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function status(): string {
  return document.querySelector('[role="status"]')?.textContent ?? '';
}

function submit(): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Copy along path',
  );
  if (found === undefined) throw new Error('submit button missing');
  return found;
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const row = Array.from(document.querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('span')?.textContent === label,
  );
  const control = row?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  if (control === null || control === undefined) throw new Error(`${label} missing`);
  return control;
}

async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    control.value = value;
    Simulate.change(control);
  });
}

describe('Copy Along Path dialog', () => {
  it('opens with its defaults and places the copies', async () => {
    await open([LOGO, LINE]);

    expect(dialog()?.textContent).toContain('Guide path: rail (open, 100 mm)');
    expect(field('Place copies by').value).toBe('count');
    expect(field('Copies').value).toBe('5');
    expect(field('Start offset (mm)').value).toBe('0');
    expect(field('End offset (mm)').disabled).toBe(false);
    expect(status()).toBe('Places 5 copies along the 100 mm guide, 25 mm apart centre to centre.');

    await act(async () => submit().click());

    expect(useStore.getState().project.scene.objects).toHaveLength(7);
    expect(dialog()).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Placed 5 copies along the guide path.',
    );
  });

  it('says what a selection is missing instead of opening', async () => {
    await open([LOGO]);

    expect(dialog()).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('needs a guide');
  });

  it('goes all the way round a closed guide, which has no end offset', async () => {
    await open([LOGO, RING]);

    expect(field('End offset (mm)').disabled).toBe(true);
    await change(field('Copies'), '8');
    expect(status()).toBe(
      'Places 8 copies all the way round the 160 mm guide, 20 mm apart centre to centre.',
    );
  });

  it('switches to spacing, starting from the artwork width plus a 2 mm gap', async () => {
    await open([LOGO, LINE]);

    await change(field('Place copies by'), 'spacing');
    expect(field('Spacing (mm)').value).toBe('17');
    expect(status()).toBe('Places 6 copies along the 100 mm guide, 17 mm apart centre to centre.');

    await change(field('Spacing (mm)'), '0');
    expect(status()).toBe('The copies would all land in one place. Set a spacing above 0 mm.');
    expect(submit().disabled).toBe(true);

    await change(field('Place copies by'), 'gap');
    expect(field('Gap (mm)').value).toBe('2');
    expect(status()).toBe('Places 6 copies along the 100 mm guide, 17 mm apart centre to centre.');
  });

  it('lets the user pick another guide when several single paths are selected', async () => {
    await open([LINE, RING]);

    expect(field('Guide path').value).toBe('ring');
    await change(field('Guide path'), 'rail');
    expect(status()).toContain('along the 100 mm guide');

    await act(async () => submit().click());
    const objects = useStore.getState().project.scene.objects;
    expect(objects.filter((object) => object.id !== 'rail' && object.id !== 'ring')).toHaveLength(
      5,
    );
  });

  it('lays nothing out while a big count is typed, then places every copy once on Copy', async () => {
    await open([LOGO, LINE]);
    vi.mocked(copyAlongPathLayout).mockClear();

    for (const count of ['4', '40', '400', '4000']) {
      await change(field('Copies'), count);
      expect(status()).toMatch(
        new RegExp(`^Places ${count} copies along the 100 mm guide, [\\d.]+ mm apart`),
      );
    }
    expect(copyAlongPathLayout).not.toHaveBeenCalled();

    await act(async () => submit().click());

    expect(copyAlongPathLayout).toHaveBeenCalledTimes(1);
    const laidOut = vi.mocked(copyAlongPathLayout).mock.results[0]?.value;
    expect(laidOut?.kind === 'placed' ? laidOut.placements : []).toHaveLength(4000);
    expect(useStore.getState().project.scene.objects).toHaveLength(2 + 4000);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('explains a count no project could hold, without laying anything out', async () => {
    await open([LOGO, LINE]);
    vi.mocked(copyAlongPathLayout).mockClear();

    await change(field('Copies'), '1000000000000');

    expect(status()).toBe(
      'This project has room for at most 9998 more copies of this artwork (project limit 10000 objects). Ask for fewer copies.',
    );
    expect(submit().disabled).toBe(true);
    expect(copyAlongPathLayout).not.toHaveBeenCalled();
  });

  it('explains a spacing so small it would place more copies than the project holds', async () => {
    await open([LOGO, LINE]);

    await change(field('Place copies by'), 'spacing');
    await change(field('Spacing (mm)'), '0.002');

    expect(status()).toBe(
      'This project has room for at most 9998 more copies of this artwork (project limit 10000 objects), and that spacing places more. Set a larger spacing.',
    );
    expect(submit().disabled).toBe(true);

    await change(field('Spacing (mm)'), '0.05');
    expect(status()).toMatch(/^Places 2001 copies along the 100 mm guide, 0\.05 mm apart/);
    expect(submit().disabled).toBe(false);
  });

  it('reopens with the settings last applied', async () => {
    await open([LOGO, LINE]);
    await change(field('Copies'), '3');
    await act(async () => {
      const keep = Array.from(document.querySelectorAll('label')).find((label) =>
        label.textContent?.includes('Keep the original'),
      );
      const input = keep?.querySelector('input');
      if (input === null || input === undefined) throw new Error('Keep the original missing');
      input.click();
    });
    await act(async () => submit().click());

    await open([LOGO, LINE]);
    expect(field('Copies').value).toBe('3');
    expect(status()).toContain('The original will be removed.');
  });
});
