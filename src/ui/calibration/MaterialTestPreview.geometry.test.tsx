import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateMaterialTestGrid } from '../../core/job/material-test-grid';
import { DEFAULT_MATERIAL_TEST_DRAFT, parseMaterialTestDraft } from './material-test-draft';
import { MaterialTestPreview } from './MaterialTestPreview';

describe('material test preview cell proportions', () => {
  it.each(['line', 'fill'] as const)(
    'matches generated %s cell aspect even for extreme strips',
    (mode) => {
      for (const [cellWidthMm, cellHeightMm] of [
        [100, 0.1],
        [0.1, 100],
        [5, 5],
      ]) {
        const options = {
          ...parseMaterialTestDraft(DEFAULT_MATERIAL_TEST_DRAFT),
          mode,
          rows: 20,
          columns: 20,
          cellWidthMm: cellWidthMm!,
          cellHeightMm: cellHeightMm!,
        };
        const actual = generateMaterialTestGrid(options).cells[0]!.bounds;
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(
          <MaterialTestPreview options={options} maxFeedMmPerMin={3000} />,
        );
        const rect = host.querySelector('[data-part="cells"] rect')!;
        const stroke = Number(rect.getAttribute('stroke-width'));
        const width = Number(rect.getAttribute('width')) + stroke;
        const height = Number(rect.getAttribute('height')) + stroke;
        expect(width / height).toBeCloseTo(
          (actual.maxX - actual.minX) / (actual.maxY - actual.minY),
          8,
        );
        expect(stroke).toBeLessThan(Math.min(width, height));
        expect(host.querySelectorAll('[data-part="row-labels"] text')).toHaveLength(20);
        expect(host.querySelectorAll('[data-part="column-labels"] text')).toHaveLength(20);
        expect(Number(host.querySelector('svg')!.getAttribute('font-size'))).toBeGreaterThanOrEqual(
          9,
        );
        expect(Number(host.querySelector('svg')!.getAttribute('width'))).toBeLessThan(340);
        expect(host.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain(
          'spacing is schematic',
        );
        expect(host.textContent).toContain(`Cells: ${cellWidthMm} × ${cellHeightMm} mm`);
      }
    },
  );
});
