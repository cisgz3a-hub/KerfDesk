import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReliefHeightfieldSourceKind } from '../../core/scene/relief';
import { ReliefSourceMeaning } from './ReliefSourceMeaning';

const SOURCE_CASES: ReadonlyArray<{
  readonly sourceKind: ReliefHeightfieldSourceKind;
  readonly label: string;
  readonly description: string;
}> = [
  {
    sourceKind: 'depth-map',
    label: 'Depth map',
    description: 'Declared scalar depth data.',
  },
  {
    sourceKind: 'brightness-emboss',
    label: 'Brightness emboss',
    description: 'Artistic emboss — not recovered 3D geometry.',
  },
  {
    sourceKind: 'relative-depth-map',
    label: 'Relative-depth map',
    description: 'Relative depth — not millimetres; map its range to physical depth.',
  },
  {
    sourceKind: 'editable-relief-map',
    label: 'Editable relief map',
    description: 'Operator-authored scalar data.',
  },
  {
    sourceKind: 'stl-top-projection',
    label: 'STL top projection',
    description: 'Top projection only; undercuts are not represented.',
  },
];

describe('ReliefSourceMeaning', () => {
  it.each(SOURCE_CASES)('shows $label as a persisted read-only declaration', (source) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ReliefSourceMeaning sourceKind={source.sourceKind} />);

    const meaning = host.querySelector('[aria-label="Relief declared source meaning"]');
    expect(meaning?.textContent).toContain('Declared source meaning');
    expect(meaning?.textContent).toContain(source.label);
    expect(meaning?.textContent).toContain(source.description);
    expect(meaning?.querySelector('input, select, button')).toBeNull();
  });
});
