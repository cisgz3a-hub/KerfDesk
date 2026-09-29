import { describe, expect, it, vi } from 'vitest';
import { importLightBurnProject } from '../../io/lightburn';
import { completeLightBurnProjectOpen } from './project-open-completion';

// Opening a LightBurn project reports what did not come across (ADR-388).

function openedToasts(shapes: string): ReadonlyArray<ReadonlyArray<unknown>> {
  const pushToast = vi.fn<(message: string, variant?: string) => void>();
  const result = importLightBurnProject(
    `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
      <Shape Type="Rect" CutIndex="0" W="10" H="10"><XForm>1 0 0 1 20 20</XForm></Shape>${shapes}
    </LightBurnProject>`,
    'sign.lbrn2',
  );
  completeLightBurnProjectOpen(
    { setProject: () => ({ kind: 'loaded' }), markLoaded: vi.fn(), pushToast },
    'sign.lbrn2',
    result,
  );
  return pushToast.mock.calls;
}

describe('opening a LightBurn project', () => {
  it('names a shape it left out, and counts it once', () => {
    const toasts = openedToasts('<Shape Type="Bitmap" CutIndex="0" W="5" H="5"/>');
    expect(toasts).toContainEqual([
      'Imported sign.lbrn2: 1 objects, 1 layers, 1 warning(s). Save as .lf2 to keep changes.',
      'warning',
    ]);
    expect(toasts).toContainEqual([
      expect.stringContaining('1 Bitmap shape was not imported'),
      'warning',
    ]);
  });

  it('says where the rest of a long report is kept', () => {
    const shapes = ['Barcode', 'Bitmap', 'Image', 'Polygon']
      .map((type) => `<Shape Type="${type}" CutIndex="0"/>`)
      .join('');
    const review = openedToasts(shapes).find(([message]) =>
      String(message).startsWith('LightBurn import review:'),
    );
    expect(review?.[0]).toMatch(
      /Image shape was not imported: .* 1 more warning\(s\) are in the import report in Window > Project Notes\.$/,
    );
  });

  it('reports nothing to review when everything came across', () => {
    expect(openedToasts('')).toEqual([
      ['Imported sign.lbrn2: 1 objects, 1 layers. Save as .lf2 to keep changes.', 'success'],
    ]);
  });
});
