import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CurveSubpath, ImportedSvg, Vec2 } from '../../core/scene';
import { importLightBurnProject } from './lbrn-import';

// An "L" drawn in LightBurn's Y-up coordinates: a stroke from (10, 30) down to
// (10, 10), then a foot to the right to (16, 10). Read the right way up, the
// foot sits at the bottom of the stroke and points right.
const L_PATH = `<VertList>V10 30c0x1c1x1V10 10c0x1c1x1V16 10c0x1c1x1</VertList><PrimList>L0 1L1 2</PrimList>`;

describe('LightBurn project orientation', () => {
  it('opens a project from a front-left origin machine right way up', () => {
    // No MirrorX / MirrorY: the usual GRBL diode, origin at the front-left, Y up.
    const [curve] = curvesOf(`<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
      <Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>${L_PATH}</Shape>
    </LightBurnProject>`);
    // The default 400 x 400 bed: scene Y points toward the operator.
    expect(points(curve)).toEqual([
      { x: 10, y: 370 },
      { x: 10, y: 390 },
      { x: 16, y: 390 },
    ]);
  });

  it.each([
    ['False', 'False', { x: 10, y: 370 }],
    ['True', 'False', { x: 390, y: 370 }],
    ['False', 'True', { x: 10, y: 30 }],
    ['True', 'True', { x: 390, y: 30 }],
  ])(
    'measures from the saving machine origin corner (MirrorX=%s, MirrorY=%s)',
    (mirrorX, mirrorY, top) => {
      const [curve] = curvesOf(`<LightBurnProject MirrorX="${mirrorX}" MirrorY="${mirrorY}">
        <Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 0 0</XForm>${L_PATH}</Shape>
      </LightBurnProject>`);
      expect(curve?.start).toEqual(top);
    },
  );

  it('places rotated groups and text through the same frame', () => {
    // The group turns its children 90 degrees counter-clockwise (Y up) and
    // moves them to (100, 50); the child adds its own 5 mm shift first.
    const curves = curvesOf(`<LightBurnProject>
      <Shape Type="Group"><XForm>0 1 -1 0 100 50</XForm><Children>
        <Shape Type="Path" CutIndex="0"><XForm>1 0 0 1 5 0</XForm>
          <VertList>V0 10c0x1c1x1V0 0c0x1c1x1V6 0c0x1c1x1</VertList><PrimList>L0 1L1 2</PrimList>
        </Shape>
      </Children></Shape>
      <Shape Type="Text" CutIndex="0" Str="L"><BackupPath Type="Path" CutIndex="0">
        <XForm>1 0 0 1 0 0</XForm>${L_PATH}</BackupPath><XForm>1 0 0 1 0 0</XForm></Shape>
    </LightBurnProject>`);
    expect(points(curves[0])).toEqual([
      { x: 90, y: 345 },
      { x: 100, y: 345 },
      { x: 100, y: 339 },
    ]);
    expect(points(curves[1])).toEqual([
      { x: 10, y: 370 },
      { x: 10, y: 390 },
      { x: 16, y: 390 },
    ]);
  });

  it('shows a real rear-right origin project the way LightBurn drew it', () => {
    // LightBurn 2.0.05 saved this with MirrorX="True" MirrorY="True". Its own
    // thumbnail shows the outline's notch along the top edge and the tall slot
    // on the right.
    const objects = importedObjects('acwright-backplane-top.lbrn2');
    const outline = objects.find((object) => segmentsOf(object).length === 16);
    if (outline === undefined) throw new Error('outline missing');
    expect(rounded(outline.bounds)).toEqual({ minX: 50, minY: 150, maxX: 150, maxY: 250 });
    // The two long horizontal edges: the notch floor near the top, the plain
    // edge at the bottom.
    const longEdges = lineSegments(curveOf(outline))
      .filter(([from, to]) => Math.abs(from.y - to.y) < 1e-6 && Math.abs(to.x - from.x) > 50)
      .map(([from]) => Math.round(from.y * 1000) / 1000)
      .sort((left, right) => left - right);
    expect(longEdges).toEqual([165.676, 250]);
    const slot = objects.find(
      (object) => object.bounds.maxY - object.bounds.minY > 60 && object !== outline,
    );
    expect(slot?.bounds.minX).toBeCloseTo(127.171, 3);
    expect(slot?.bounds.maxX).toBeCloseTo(139.021, 3);
  });
});

function curvesOf(xml: string): CurveSubpath[] {
  const result = importLightBurnProject(xml, 'orientation.lbrn2');
  if (!result.ok) throw new Error(result.reason);
  return result.project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? object.paths.flatMap((path) => path.curves ?? []) : [],
  );
}

function importedObjects(name: string): ImportedSvg[] {
  const xml = readFileSync(
    resolve(process.cwd(), 'src/__fixtures__/lightburn/external/lbrn', name),
    'utf8',
  );
  const result = importLightBurnProject(xml, name);
  if (!result.ok) throw new Error(result.reason);
  return result.project.scene.objects.flatMap((object) =>
    object.kind === 'imported-svg' ? [object] : [],
  );
}

function curveOf(object: ImportedSvg): CurveSubpath {
  const curve = object.paths[0]?.curves?.[0];
  if (curve === undefined) throw new Error('curve missing');
  return curve;
}

function segmentsOf(object: ImportedSvg): CurveSubpath['segments'] {
  return object.paths[0]?.curves?.[0]?.segments ?? [];
}

function points(curve: CurveSubpath | undefined): Vec2[] {
  if (curve === undefined) throw new Error('curve missing');
  return [curve.start, ...curve.segments.map((segment) => segment.to)];
}

function lineSegments(curve: CurveSubpath): Array<readonly [Vec2, Vec2]> {
  const lines: Array<readonly [Vec2, Vec2]> = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'line') lines.push([from, segment.to]);
    from = segment.to;
  }
  return lines;
}

function rounded(bounds: ImportedSvg['bounds']): ImportedSvg['bounds'] {
  return {
    minX: Math.round(bounds.minX * 1000) / 1000,
    minY: Math.round(bounds.minY * 1000) / 1000,
    maxX: Math.round(bounds.maxX * 1000) / 1000,
    maxY: Math.round(bounds.maxY * 1000) / 1000,
  };
}
