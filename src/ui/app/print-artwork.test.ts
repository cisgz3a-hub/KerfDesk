import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, createProject, type ImportedSvg } from '../../core/scene';
import { printableArtworkSvg, styledPrintSvg } from './print-artwork';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10mm"><path stroke="#ff0000" fill="none"/></svg>';

describe('print artwork', () => {
  it('sets the printed line width and forces black only when asked', () => {
    const colour = styledPrintSvg(SVG, { blackOnly: false, lineWidthMm: 0.3 });
    expect(colour).toContain(
      '<style>*{stroke-width:0.3px !important;vector-effect:none}</style><path',
    );
    expect(colour).not.toContain('stroke:#000');
    const black = styledPrintSvg(SVG, { blackOnly: true, lineWidthMm: 0.3 });
    expect(black).toContain('[stroke]:not([stroke="none"]){stroke:#000 !important}');
    expect(black).toContain('[fill]:not([fill="none"]){fill:#000 !important}');
  });

  it('prints only the selection and refuses an empty project', async () => {
    const line: ImportedSvg = {
      kind: 'imported-svg',
      id: 'a',
      source: 'a.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const project = { ...createProject(), scene: { ...createProject().scene, objects: [line] } };
    const result = await printableArtworkSvg(
      project,
      ['a'],
      { blackOnly: true, lineWidthMm: 0.2 },
      new Date(0),
    );
    expect(result.ok && result.svg).toContain('stroke-width:0.2px');
    expect(
      await printableArtworkSvg(
        createProject(),
        [],
        { blackOnly: true, lineWidthMm: 0.2 },
        new Date(0),
      ),
    ).toEqual({
      ok: false,
      message: 'There is no artwork to print.',
    });
  });
});
