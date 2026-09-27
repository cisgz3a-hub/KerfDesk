import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';

const textMocks = vi.hoisted(() => ({
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
  textToPolylines: vi.fn(async (input: { readonly color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [
      {
        color: input.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 5 },
              { x: 5, y: 5 },
            ],
          },
        ],
      },
    ],
  })),
}));

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  loadFont: textMocks.loadFont,
}));
vi.mock('../../core/text', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreText>();
  return { ...actual, textToPolylines: textMocks.textToPolylines };
});

import { useStore } from '../state';
import { svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
});

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ textDialog: null });
});

it('saves where path text sits along and across its guide (ADR-480)', async () => {
  const guide = addStraightGuide();
  useUiStore.setState({ textDialog: { mode: 'add' } });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AddTextDialog />));
    await act(async () => {
      const content = host.querySelector('textarea');
      if (!(content instanceof HTMLTextAreaElement)) throw new Error('Text area missing');
      content.value = 'Path text';
      Simulate.change(content);
      const toggle = host.querySelector('input[title="Place text along a selected vector path."]');
      if (!(toggle instanceof HTMLInputElement)) throw new Error('Path toggle missing');
      toggle.checked = true;
      Simulate.change(toggle);
    });
    await act(async () => {
      choose(host, 'Text position along the path', 'middle');
      choose(host, 'Text position across the path', 'below');
    });
    await act(async () => {
      const form = host.querySelector('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('Text form missing');
      Simulate.submit(form);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      useStore.getState().project.scene.objects.find((object) => object.kind === 'text'),
    ).toMatchObject({
      pathText: {
        guideObjectId: guide,
        offsetMm: 0,
        reverse: false,
        alongAlign: 'middle',
        acrossAlign: 'below',
      },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function addStraightGuide(): string {
  const guide = svgObj('guide-path', ['#ff0000']);
  const straight = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  useStore.getState().importSvgObject({
    ...guide,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    paths: [{ color: '#ff0000', polylines: [{ closed: false, points: straight }] }],
  });
  useStore.getState().selectObject(guide.id);
  return guide.id;
}

function choose(host: HTMLElement, label: string, value: string): void {
  const select = host.querySelector(`select[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${label} missing`);
  select.value = value;
  Simulate.change(select);
}
