import { describe, expect, it } from 'vitest';
import type { FixtureGenerator, HoleGridGenerator, PartGeneratorKind } from './part-generator';
import { defaultPartGenerator } from './part-generator';
import { materializePartGenerator } from './materialize-part-generator';
import {
  partGeneratorGeometryMatches,
  regeneratePartGenerator,
  bakePartGenerator,
} from './regenerate-part-generator';
import { generatedPart, requirePart } from './part-generator.test-fixture';
import {
  parsePartGeneratorSource,
  parsePartGeneratorDefinition,
} from '../../io/project/project-part-generator-validator';
import { flattenCurveSubpath } from '../scene/curve-path';

describe('bounded linked part generators', () => {
  it.each<PartGeneratorKind>(['panel', 'bracket', 'hole-grid', 'fixture'])(
    'materializes analytical %s dimensions and exact circular holes',
    (kind) => {
      const definition = defaultPartGenerator(kind);
      const built = requirePart(materializePartGenerator(definition));
      expect(built.bounds).toEqual({
        minX: 0,
        minY: 0,
        maxX: definition.widthMm,
        maxY: definition.heightMm,
      });
      expect(new Set(built.source.pathKeys).size).toBe(built.paths.length);
      expect(built.source.pathKeys[0]).toBe('boundary');
      const hole = built.paths[1]?.curves?.[0];
      if (hole === undefined) throw new Error('Missing exact hole');
      expect(hole.segments.map((segment) => segment.kind)).toEqual([
        'elliptical-arc',
        'elliptical-arc',
      ]);
      expect(flattenCurveSubpath(hole, { toleranceMm: 0.01 }).kind).toBe('ok');
      expect(parsePartGeneratorSource(JSON.parse(JSON.stringify(built.source)))).toEqual({
        kind: 'ok',
        value: built.source,
      });
    },
  );
  it('preserves semantic hole bindings and tabs when row indices shift after resizing', () => {
    const original = generatedPart();
    const definition = original.partGenerator.definition as HoleGridGenerator;
    const key = 'hole-r1-c0';
    const index = original.partGenerator.pathKeys.indexOf(key);
    const edited = {
      ...original,
      name: 'Operator label',
      paths: original.paths.map((path, i) =>
        i === index
          ? { ...path, color: '#ff0000', operationIds: ['manual-hole'], strokeWidthMm: 0.25 }
          : path,
      ),
      cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: index, polylineIndex: 0, pathT: 0.3 }],
    };
    const result = requirePart(
      regeneratePartGenerator(edited, { ...definition, widthMm: 80, columns: 5 }),
    );
    const nextIndex = result.partGenerator.pathKeys.indexOf(key);
    expect(nextIndex).not.toBe(index);
    expect(result.paths[nextIndex]).toMatchObject({
      color: '#ff0000',
      operationIds: ['manual-hole'],
      strokeWidthMm: 0.25,
    });
    expect(result.cncTabAnchors?.[0]?.pathIndex).toBe(nextIndex);
    expect(result.operationOverride).toBe(original.operationOverride);
    expect(result.transform).toBe(original.transform);
    expect(result.id).toBe(original.id);
    expect(result.name).toBe('Operator label');
    expect(result.paths[result.partGenerator.pathKeys.indexOf('hole-r0-c4')]?.operationIds).toEqual(
      ['holes'],
    );
    expect(partGeneratorGeometryMatches(result)).toBe(true);
  });
  it('keeps fixture mounts independent from hole-grid row and column dependencies', () => {
    const original = generatedPart(defaultPartGenerator('fixture'));
    const definition = original.partGenerator.definition as FixtureGenerator;
    const next = requirePart(
      regeneratePartGenerator(original, { ...definition, rows: 3, columns: 4, widthMm: 80 }),
    );
    expect(next.partGenerator.pathKeys.slice(0, 5)).toEqual(
      original.partGenerator.pathKeys.slice(0, 5),
    );
    expect(next.paths[1]?.polylines).toEqual(original.paths[1]?.polylines);
    expect(next.paths[2]?.polylines[0]?.points[0]?.x).toBe(74.5);
    expect(next.paths).toHaveLength(17);
  });
  it('rejects nonfinite dimensions, oversized grids, collisions and unsupported source payloads', () => {
    const grid = defaultPartGenerator('hole-grid') as HoleGridGenerator;
    for (const definition of [
      { ...grid, widthMm: NaN },
      { ...grid, heightMm: 0 },
      { ...grid, widthMm: 100001 },
      { ...grid, rows: 32, columns: 32 },
      { ...grid, edgeOffsetMm: 1 },
      { ...grid, columns: 32, widthMm: 20 },
    ])
      expect(parsePartGeneratorDefinition(definition).kind).toBe('invalid');
    const source = generatedPart().partGenerator;
    for (const value of [
      { ...source, version: 2 },
      { ...source, arbitrary: true },
      { ...source, definition: { ...source.definition, unsupported: true } },
      { ...source, pathKeys: ['boundary', 'boundary'] },
    ])
      expect(parsePartGeneratorSource(value).kind).toBe('invalid');
    const large = requirePart(
      materializePartGenerator({ ...grid, widthMm: 1000, heightMm: 1000, rows: 16, columns: 32 }),
    );
    expect(large.paths).toHaveLength(513);
  });
  it('detects current manual geometry and bakes it without rewriting paths or settings', () => {
    const original = generatedPart();
    const modified = { ...original, paths: original.paths.slice(1) };
    expect(partGeneratorGeometryMatches(modified)).toBe(false);
    const baked = bakePartGenerator(modified);
    expect(baked.partGenerator).toBeUndefined();
    expect(baked.paths).toBe(modified.paths);
    expect(baked.operationOverride).toBe(modified.operationOverride);
    expect(baked.transform).toBe(modified.transform);
  });
});
