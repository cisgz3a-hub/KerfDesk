// Perf audit S1, S7-P3-2: the text frame preview builds its path once per
// render result, at the preview's resolution, instead of joining every point
// of the last result on every keystroke.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Polyline } from '../../core/scene';
import type { TextRenderResult } from '../../core/text';
import { resetStore } from '../state/test-helpers';
import type * as PreviewPath from './text-frame-preview-path';
import { textFramePreviewGeometry } from './text-frame-preview-path';
import { TextBoxFields } from './TextBoxFields';
import { useTextDialogFields, type DialogFields } from './use-text-dialog-fields';

const built = vi.hoisted(() => ({ count: 0 }));

vi.mock('./text-frame-preview-path', async (importOriginal) => {
  const actual = await importOriginal<typeof PreviewPath>();
  return {
    ...actual,
    textFramePreviewGeometry: (...args: Parameters<typeof actual.textFramePreviewGeometry>) => {
      built.count += 1;
      return actual.textFramePreviewGeometry(...args);
    },
  };
});

const LAYOUT = {
  content: 'A',
  sizeMm: 2,
  widthMm: 60,
  heightMm: 30,
  lineCount: 1,
  advanceWidthMm: 5,
  overflow: false,
};

vi.mock('./render-text-geometry', () => ({
  renderTextGeometry: vi.fn(async () => ({
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    paths: [],
    textBoxLayout: LAYOUT,
  })),
}));

// Glyph-like loops: many points a hair apart, as an outline font emits them.
function glyphs(count: number, pointsEach: number): TextRenderResult {
  const polylines: Polyline[] = Array.from({ length: count }, (_, index) => ({
    closed: true,
    points: Array.from({ length: pointsEach }, (_, point) => {
      const angle = (point / pointsEach) * Math.PI * 2;
      return {
        x: 1 + (index % 40) * 1.4 + 0.5 * Math.cos(angle),
        y: 1 + Math.floor(index / 40) * 1.4 + 0.5 * Math.sin(angle),
      };
    }),
  }));
  return {
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 30 },
    paths: [{ color: '#000000', polylines }],
    textBoxLayout: LAYOUT,
  };
}

const drawn = (path: string): number => (path.match(/[ML]/g) ?? []).length;

describe('text frame preview path (perf audit S7-P3-2)', () => {
  it('draws 250,000 outline points at the preview resolution', () => {
    const preview = glyphs(800, 312);
    const geometry = textFramePreviewGeometry(preview, LAYOUT);
    expect(drawn(geometry.paths)).toBeLessThan(250_000 / 4);
    expect(geometry.paths.match(/Z/g)).toHaveLength(800);
  });

  it('keeps every point that is a visible step apart', () => {
    const geometry = textFramePreviewGeometry(glyphs(1, 24), LAYOUT);
    expect(drawn(geometry.paths)).toBe(24);
  });
});

describe('the frame preview while keys arrive', () => {
  let host: HTMLDivElement;
  let root: Root;
  let fields: DialogFields;

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
        textBox: {
          mode: 'fixed',
          widthMm: 60,
          heightMm: 30,
          wrap: true,
          fit: 'shrink',
          minSizeMm: 2,
        },
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
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('builds the path once per result, not once per key', async () => {
    expect(host.querySelector('[aria-label="Text frame layout preview"]')).not.toBeNull();
    const before = built.count;
    for (const content of ['AB', 'ABC', 'ABCD', 'ABCDE', 'ABCDEF']) {
      await act(async () => fields.setContent(content));
    }
    // Five keys re-rendered the preview with the result it already had.
    expect(built.count).toBe(before);
  });
});
